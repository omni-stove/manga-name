import type { Bubble, ID, Page, Patch } from '@manga/schema'
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
  resizedBubble,
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
  | { kind: 'create'; pointerId: number; panelId: ID; at: Pos; client: Pos }
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
  | { kind: 'tail'; pointerId: number; start: Bubble; client: Pos; dragging: boolean }

/** 選択中のフキダシのハンドル（ページ座標、mm）。しっぽが無ければ下に未設定の先端を置く */
export function bubbleHandles(
  bubble: Bubble,
  panel: Box,
): {
  corners: { handle: BubbleHandle; x: number; y: number }[]
  tail: PagePoint & { set: boolean }
} {
  const g = bubbleGeometry(bubble, panel)
  return {
    corners: [
      { handle: 'nw', x: g.cx - g.rx, y: g.cy - g.ry },
      { handle: 'ne', x: g.cx + g.rx, y: g.cy - g.ry },
      { handle: 'se', x: g.cx + g.rx, y: g.cy + g.ry },
      { handle: 'sw', x: g.cx - g.rx, y: g.cy + g.ry },
    ],
    tail: g.tail ? { ...g.tail, set: true } : { x: g.cx, y: g.cy + g.ry * 1.5, set: false },
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
 * `bubble` ツールの操作。コマの何も無いところをクリックすると既定のフキダシを作って選び、
 * フキダシのドラッグで移動、選択中のフキダシの隅のハンドルでリサイズ、しっぽの先端のドラッグで
 * しっぽを動かす（無ければ作る）。ドラッグ中は `draft` を描くだけで、Patch は pointerup で 1 回だけ出す。
 * フキダシを動かさずに離したときの選択は useSelection に任せる。Escape でドラッグを取り消す
 */
export function useBubbleTool(opts: Options) {
  const [draft, setDraft] = useState<BubbleDraft | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const active = opts.tool === 'bubble'
  const selectedId = opts.selection?.kind === 'bubble' ? opts.selection.id : undefined
  const found = active && selectedId !== undefined ? findBubble(opts.page, selectedId) : undefined
  const selected = found && {
    bubble: found.bubble,
    panel: panelBox(found.panel, opts.width, opts.height),
  }
  const handleSize = opts.view.w * HANDLE_RATIO

  const pointAt = (e: ReactPointerEvent<SVGSVGElement>) =>
    clientToPage(opts.view, boxOf(e.currentTarget), { x: e.clientX, y: e.clientY })
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
    return tailedBubble(g.start, toPanel(box, p))
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
        const { corners, tail } = bubbleHandles(selected.bubble, selected.panel)
        // しっぽの先端は本体の隅と重なりうるので先に見る
        if (near(at, tail)) {
          take(e, {
            kind: 'tail',
            pointerId: e.pointerId,
            start: selected.bubble,
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
        if (!start) return
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
      if (g.kind === 'create') {
        if (Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) > CLICK_SLOP) {
          gesture.current = null
        }
        return
      }
      if (!g.dragging) {
        if (Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) <= CLICK_SLOP) return
        g.dragging = true
      }
      const box = panelOf(g.start.id)
      const at = pointAt(e)
      if (!box || at === null) return
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
        const created = createBubblePatch(opts.page, g.panelId, g.at)
        if (!created) return
        opts.onChange(created.patch)
        opts.onSelect({ kind: 'bubble', id: created.id })
        return
      }
      if (!g.dragging) return
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
