import { type Bubble, hasTail, type ID, type Page, type Patch } from '@manga/schema'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react'
import {
  type BubbleHandle,
  createBubblePatch,
  findBubble,
  movedBubble,
  newBubble,
  resizedBubble,
  spannedRect,
  tailedBubble,
  updateBubblePatch,
} from './bubble-ops'
import { type Box, bubbleGeometry } from './bubble-shape'
import { hitTest, type PagePoint, panelAt, panelBox } from './hit-test'
import type { Selection, Tool } from './types'
import { HANDLE_RATIO } from './use-panel-tool'
import { CLICK_SLOP } from './use-selection'
import { capture } from './use-viewport'
import { type ClientBox, clientToPage, type View } from './view'

interface Options {
  page: Page
  /** ページの大きさ（mm） */
  width: number
  height: number
  view: View
  /** パンやピンチの最中。進行中の操作を取り消し、新しい操作も始めない */
  panning: boolean
  tool: Tool
  selection: Selection
  onChange(patch: Patch): void
  onSelect(sel: Selection): void
}

/** ドラッグ中のフキダシの姿と、それを置くコマのページ座標の矩形 */
export interface BubbleDraft {
  bubble: Bubble
  panel: Box
}

type Pos = { x: number; y: number }

type Gesture =
  | { kind: 'create'; pointerId: number; panelId: ID; at: Pos; client: Pos; dragging: boolean }
  | {
      kind: 'move'
      pointerId: number
      start: Bubble
      from: PagePoint
      client: Pos
      dragging: boolean
    }
  | {
      kind: 'resize'
      pointerId: number
      start: Bubble
      handle: BubbleHandle
      client: Pos
      dragging: boolean
    }
  | {
      kind: 'tail'
      pointerId: number
      start: Bubble
      /** 動かすしっぽの添字。tails の長さなら新しいしっぽ */
      index: number
      client: Pos
      dragging: boolean
    }

const DIAGONAL = Math.SQRT1_2
/**
 * 新しいしっぽのハンドルを置く向き（y 下向き）。真下から順に、既存のしっぽと離れた向きを選ぶ。
 * 角度から三角関数で求めると真下でも x に誤差が乗るので、単位ベクトルで持つ
 */
const NEW_TAIL_DIRECTIONS = [
  { x: 0, y: 1 },
  { x: -DIAGONAL, y: DIAGONAL },
  { x: DIAGONAL, y: DIAGONAL },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -DIAGONAL, y: -DIAGONAL },
  { x: DIAGONAL, y: -DIAGONAL },
  { x: 0, y: -1 },
] as const
/** 新しいしっぽのハンドルを既存のしっぽから離す角度（ラジアン） */
const NEW_TAIL_CLEARANCE = Math.PI / 6

const angleBetween = (a: number, b: number) => {
  const d = Math.abs(a - b) % (Math.PI * 2)
  return Math.min(d, Math.PI * 2 - d)
}

/**
 * 選択中のフキダシのハンドル（ページ座標、mm）。tails はしっぽごとの先端で、index は Bubble.tails の添字。
 * add はドラッグで新しいしっぽを足すハンドルで、既存のしっぽと重ならない向きに置く。
 * しっぽの付かない形なら tails は空で add は null
 */
export function bubbleHandles(
  bubble: Bubble,
  panel: Box,
): {
  corners: { handle: BubbleHandle; x: number; y: number }[]
  tails: (PagePoint & { index: number })[]
  add: PagePoint | null
} {
  const g = bubbleGeometry(bubble, panel)
  const corners: { handle: BubbleHandle; x: number; y: number }[] = [
    { handle: 'nw', x: g.cx - g.rx, y: g.cy - g.ry },
    { handle: 'ne', x: g.cx + g.rx, y: g.cy - g.ry },
    { handle: 'se', x: g.cx + g.rx, y: g.cy + g.ry },
    { handle: 'sw', x: g.cx - g.rx, y: g.cy + g.ry },
  ]
  if (!hasTail(bubble.shape)) return { corners, tails: [], add: null }
  const tails = (g.tails ?? []).map((t, index) => ({ ...t, index }))
  // 楕円を半径で割って円に直した向きで比べる
  const taken = tails.map((t) => Math.atan2((t.y - g.cy) / (g.ry || 1), (t.x - g.cx) / (g.rx || 1)))
  const free = (d: { x: number; y: number }) =>
    taken.every((t) => angleBetween(Math.atan2(d.y, d.x), t) > NEW_TAIL_CLEARANCE)
  const d = NEW_TAIL_DIRECTIONS.find(free) ?? NEW_TAIL_DIRECTIONS[0]
  return {
    corners,
    tails,
    add: { x: g.cx + g.rx * 1.5 * d.x, y: g.cy + g.ry * 1.5 * d.y },
  }
}

function boxOf(el: Element): ClientBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

const toPanel = (box: Box, p: PagePoint): Pos => ({
  x: (p.x - box.x) / box.w,
  y: (p.y - box.y) / box.h,
})

/**
 * `bubble` ツールの操作。コマの何も無いところをクリックすると既定の大きさのフキダシを、ドラッグすると
 * 押した点と離した点を対角にした大きさのフキダシを作って選ぶ。大きさを決める点は押したコマに収める。
 * フキダシのドラッグで移動、選択中のフキダシの隅のハンドルでリサイズ、しっぽごとの先端のドラッグで
 * そのしっぽを動かし、しっぽを足すハンドルのドラッグで新しいしっぽを作る。動かしたり押したりしたしっぽは
 * 最後に触ったしっぽとして tails の末尾に回す。位置をロックしたフキダシは動かさず、ハンドルも出さない。作成では本体をコマの枠に収め、移動とリサイズでは収めない。
 * ドラッグ中は `draft` を描くだけで、Patch は pointerup で 1 回だけ出す。
 * フキダシを動かさずに離したときの選択は useSelection に任せる。Escape でドラッグを取り消す
 */
export function useBubbleTool(opts: Options) {
  const [draft, setDraft] = useState<BubbleDraft | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const active = opts.tool === 'bubble'
  const selectedId = opts.selection?.kind === 'bubble' ? opts.selection.id : undefined
  const found = active && selectedId !== undefined ? findBubble(opts.page, selectedId) : undefined
  const selected =
    found && !found.bubble.locked
      ? { bubble: found.bubble, panel: panelBox(found.panel, opts.width, opts.height) }
      : undefined
  const handleSize = opts.view.w * HANDLE_RATIO

  const pointAt = (e: ReactPointerEvent<SVGSVGElement>) =>
    clientToPage(opts.view, boxOf(e.currentTarget), { x: e.clientX, y: e.clientY })
  const pageSize = { w: opts.width, h: opts.height }
  /** 作成のドラッグで点 p まで広げた矩形（コマ内座標）。コマが消えていれば undefined */
  const spanAt = (g: Extract<Gesture, { kind: 'create' }>, p: PagePoint) => {
    const panel = opts.page.panels.find((x) => x.id === g.panelId)
    if (!panel) return undefined
    const box = panelBox(panel, opts.width, opts.height)
    return { panel, box, rect: spannedRect(g.at, toPanel(box, p)) }
  }
  const panelOf = (bubbleId: ID) => {
    const f = findBubble(opts.page, bubbleId)
    return f && panelBox(f.panel, opts.width, opts.height)
  }
  const end = () => {
    gesture.current = null
    setDraft(null)
  }
  const take = (e: ReactPointerEvent<SVGSVGElement>, g: Gesture) => {
    // useSelection にクリックとして拾わせない
    e.preventDefault()
    e.currentTarget.focus({ preventScroll: true })
    capture(e.currentTarget, e.pointerId)
    gesture.current = g
  }
  /** ドラッグ中の点 p での姿 */
  const shapeAt = (g: Exclude<Gesture, { kind: 'create' }>, box: Box, p: PagePoint): Bubble => {
    if (g.kind === 'move') {
      return movedBubble(g.start, (p.x - g.from.x) / box.w, (p.y - g.from.y) / box.h)
    }
    if (g.kind === 'resize') return resizedBubble(g.start, g.handle, toPanel(box, p))
    return tailedBubble(g.start, g.index, toPanel(box, p))
  }
  const near = (a: PagePoint, b: PagePoint) =>
    Math.abs(a.x - b.x) <= handleSize && Math.abs(a.y - b.y) <= handleSize

  const handlers = {
    onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
      if (!active || opts.panning || gesture.current !== null) return
      if (e.defaultPrevented || e.button !== 0 || e.isPrimary === false) return
      const at = pointAt(e)
      if (at === null) return
      const client = { x: e.clientX, y: e.clientY }
      if (selected) {
        const { corners, tails, add } = bubbleHandles(selected.bubble, selected.panel)
        // しっぽの先端は本体の隅と重なりうるので先に見る。重なったしっぽは上に描く最後に触ったものを取る
        const tail = tails.findLast((t) => near(at, t))
        const index = tail ? tail.index : add && near(at, add) ? tails.length : undefined
        if (index !== undefined) {
          take(e, {
            kind: 'tail',
            pointerId: e.pointerId,
            start: selected.bubble,
            index,
            client,
            dragging: false,
          })
          return
        }
        const corner = corners.find((c) => near(at, c))
        if (corner) {
          take(e, {
            kind: 'resize',
            pointerId: e.pointerId,
            start: selected.bubble,
            handle: corner.handle,
            client,
            dragging: false,
          })
          setDraft(selected)
          return
        }
      }
      const hit = hitTest(opts.page, opts.width, opts.height, at)
      if (hit?.kind === 'bubble') {
        const start = findBubble(opts.page, hit.id)?.bubble
        // ロックしたフキダシの上では新しいフキダシも作らず、クリックの選択だけを useSelection に任せる
        if (!start || start.locked) return
        // 動かさずに離せば useSelection のクリックになるよう、preventDefault しない
        capture(e.currentTarget, e.pointerId)
        gesture.current = {
          kind: 'move',
          pointerId: e.pointerId,
          start,
          from: at,
          client,
          dragging: false,
        }
        return
      }
      const panel = panelAt(opts.page, opts.width, opts.height, at)
      if (!panel) return
      take(e, {
        kind: 'create',
        pointerId: e.pointerId,
        panelId: panel.id,
        at: toPanel(panelBox(panel, opts.width, opts.height), at),
        client,
        dragging: false,
      })
    },
    onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
      const g = gesture.current
      if (!g) return
      if (opts.panning) {
        end()
        return
      }
      if (g.pointerId !== e.pointerId) return
      if (!g.dragging) {
        if (Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) <= CLICK_SLOP) return
        g.dragging = true
      }
      const at = pointAt(e)
      if (at === null) return
      if (g.kind === 'create') {
        const span = spanAt(g, at)
        if (!span) return
        const { panel, box, rect } = span
        setDraft({ bubble: newBubble(panel, rect.pos, pageSize, rect.size), panel: box })
        return
      }
      const box = panelOf(g.start.id)
      if (!box) return
      setDraft({ bubble: shapeAt(g, box, at), panel: box })
    },
    onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
      const g = gesture.current
      if (!g) return
      if (opts.panning) {
        end()
        return
      }
      if (g.pointerId !== e.pointerId) return
      end()
      if (g.kind === 'create') {
        const at = g.dragging ? pointAt(e) : null
        const rect = at === null ? undefined : spanAt(g, at)?.rect
        const created = rect
          ? createBubblePatch(opts.page, g.panelId, rect.pos, pageSize, rect.size)
          : createBubblePatch(opts.page, g.panelId, g.at, pageSize)
        if (!created) return
        opts.onChange(created.patch)
        opts.onSelect({ kind: 'bubble', id: created.id })
        return
      }
      if (!g.dragging) {
        // 押しただけのしっぽも、右クリックの「しっぽを消す」が消す最後に触ったしっぽにする
        const tip = g.kind === 'tail' ? g.start.tails?.[g.index] : undefined
        if (tip && g.kind === 'tail') {
          const patch = updateBubblePatch(opts.page, tailedBubble(g.start, g.index, tip))
          if (patch.length > 0) opts.onChange(patch)
        }
        return
      }
      const box = panelOf(g.start.id)
      const at = pointAt(e)
      if (!box || at === null) return
      const patch = updateBubblePatch(opts.page, shapeAt(g, box, at))
      if (patch.length > 0) opts.onChange(patch)
      if (selectedId !== g.start.id) opts.onSelect({ kind: 'bubble', id: g.start.id })
    },
    onPointerCancel(e: ReactPointerEvent<SVGSVGElement>) {
      if (gesture.current?.pointerId === e.pointerId) end()
    },
    /** ドラッグ中の Escape を取り消しとして受けたら true。そのときは選択解除をさせない */
    onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>): boolean {
      if (e.key !== 'Escape' || gesture.current === null) return false
      e.preventDefault()
      end()
      return true
    },
  }

  return { draft: active ? draft : null, selected, handleSize, handlers }
}
