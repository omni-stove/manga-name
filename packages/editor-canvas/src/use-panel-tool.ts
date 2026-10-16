import type { ID, Page, Patch, ReadingDirection, Rect } from '@manga/schema'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react'
import type { Box } from './bubble-shape'
import { type PagePoint, panelAt, panelBox } from './hit-test'
import {
  createPanelPatch,
  draftRect,
  type Handle,
  mergePanelsPatch,
  resizePanelPatch,
  resizeRect,
  type SplitAxis,
  splitPanelPatch,
} from './panel-ops'
import type { Selection, Tool } from './types'
import { CLICK_SLOP } from './use-selection'
import { capture } from './use-viewport'
import { type ClientBox, clientToPage, type View } from './view'

interface Options {
  page: Page
  /** ページの大きさ（mm） */
  width: number
  height: number
  view: View
  tool: Tool
  direction: ReadingDirection
  selection: Selection
  onChange(patch: Patch): void
  onSelect(sel: Selection): void
}

/** ドラッグ中に描く矩形。panelId があればそのコマのリサイズ、無ければ新しいコマ */
export interface Draft {
  rect: Rect
  panelId?: ID
}

type Pos = { x: number; y: number }

type Gesture =
  | { kind: 'create'; pointerId: number; from: Pos; client: Pos; dragging: boolean }
  | { kind: 'resize'; pointerId: number; panelId: ID; handle: Handle; start: Rect }
  | { kind: 'merge'; pointerId: number; targetId: ID; client: Pos }

/** ハンドルの一辺。viewBox の幅に対する比率なので、ズームしても画面上の大きさが変わらない */
const HANDLE_RATIO = 0.018

/** コマの 4 隅と 4 辺の中点にあるハンドルの位置（ページ座標、mm） */
export function handlePoints(box: Box): { handle: Handle; x: number; y: number }[] {
  const right = box.x + box.w
  const bottom = box.y + box.h
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  return [
    { handle: 'nw', x: box.x, y: box.y },
    { handle: 'ne', x: right, y: box.y },
    { handle: 'se', x: right, y: bottom },
    { handle: 'sw', x: box.x, y: bottom },
    { handle: 'n', x: cx, y: box.y },
    { handle: 's', x: cx, y: bottom },
    { handle: 'e', x: right, y: cy },
    { handle: 'w', x: box.x, y: cy },
  ]
}

/** 点 p で掴めるハンドル。描いた大きさの倍まで掴めるようにする。隅を辺より優先する */
function handleAt(box: Box, p: PagePoint, size: number): Handle | undefined {
  const hit = handlePoints(box).find(
    (h) => Math.abs(p.x - h.x) <= size && Math.abs(p.y - h.y) <= size,
  )
  return hit?.handle
}

function boxOf(el: Element): ClientBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * `panel` ツールの操作。何も無いところやコマの上のドラッグで矩形のコマを作り、作ったコマを選ぶ。
 * 選択中のコマはハンドルのドラッグでリサイズし、Shift を押しながら別のコマを押すとそのコマと結合する。
 * 分割は `split` で行う。ドラッグ中は `draft` を描くだけで、Patch は pointerup で 1 回だけ出す。
 * 動かずに離したときは何もせず、クリックの選択は useSelection に任せる。Escape でドラッグを取り消す
 */
export function usePanelTool(opts: Options) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const active = opts.tool === 'panel'
  const selectedId = opts.selection?.kind === 'panel' ? opts.selection.id : undefined
  const selected = active ? opts.page.panels.find((p) => p.id === selectedId) : undefined
  const handleSize = opts.view.w * HANDLE_RATIO

  const pointAt = (e: ReactPointerEvent<SVGSVGElement>) => {
    const mm = clientToPage(opts.view, boxOf(e.currentTarget), { x: e.clientX, y: e.clientY })
    return mm && { mm, n: { x: mm.x / opts.width, y: mm.y / opts.height } }
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

  const handlers = {
    onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
      if (!active || gesture.current !== null) return
      if (e.defaultPrevented || e.button !== 0 || e.isPrimary === false) return
      const at = pointAt(e)
      if (at === null) return
      const client = { x: e.clientX, y: e.clientY }
      if (selected) {
        const handle = handleAt(panelBox(selected, opts.width, opts.height), at.mm, handleSize)
        if (handle) {
          take(e, {
            kind: 'resize',
            pointerId: e.pointerId,
            panelId: selected.id,
            handle,
            start: selected.rect,
          })
          setDraft({ rect: selected.rect, panelId: selected.id })
          return
        }
        if (e.shiftKey) {
          const target = panelAt(opts.page, opts.width, opts.height, at.mm)
          if (target && target.id !== selected.id) {
            take(e, { kind: 'merge', pointerId: e.pointerId, targetId: target.id, client })
            return
          }
        }
      }
      capture(e.currentTarget, e.pointerId)
      gesture.current = {
        kind: 'create',
        pointerId: e.pointerId,
        from: at.n,
        client,
        dragging: false,
      }
    },
    onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
      const g = gesture.current
      if (!g || g.pointerId !== e.pointerId) return
      if (g.kind === 'resize') {
        const at = pointAt(e)
        if (at === null) return
        setDraft({
          rect: resizeRect(opts.page, g.panelId, g.start, g.handle, at.n),
          panelId: g.panelId,
        })
        return
      }
      const moved = Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y)
      if (g.kind === 'merge') {
        if (moved > CLICK_SLOP) gesture.current = null
        return
      }
      if (!g.dragging && moved <= CLICK_SLOP) return
      const at = pointAt(e)
      if (at === null) return
      g.dragging = true
      setDraft({ rect: draftRect(opts.page, g.from, at.n) })
    },
    onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
      const g = gesture.current
      if (!g || g.pointerId !== e.pointerId) return
      end()
      if (g.kind === 'merge') {
        if (selectedId === undefined) return
        const patch = mergePanelsPatch(opts.page, selectedId, g.targetId, opts.direction)
        if (patch.length > 0) opts.onChange(patch)
        return
      }
      const at = pointAt(e)
      if (at === null) return
      if (g.kind === 'create') {
        if (!g.dragging) return
        const created = createPanelPatch(opts.page, draftRect(opts.page, g.from, at.n))
        if (!created) return
        opts.onChange(created.patch)
        opts.onSelect({ kind: 'panel', id: created.id })
        return
      }
      const rect = resizeRect(opts.page, g.panelId, g.start, g.handle, at.n)
      const patch = resizePanelPatch(opts.page, g.panelId, rect)
      if (patch.length > 0) opts.onChange(patch)
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

  /** 選択中のコマを割る */
  const split = (axis: SplitAxis) => {
    if (!selected) return
    const patch = splitPanelPatch(opts.page, selected.id, axis, opts.direction)
    if (patch.length > 0) opts.onChange(patch)
  }

  return { draft: active ? draft : null, selected, handleSize, split, handlers }
}
