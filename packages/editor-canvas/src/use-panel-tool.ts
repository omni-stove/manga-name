import {
  type ID,
  type Page,
  type Patch,
  type Point,
  panelOutline,
  type ReadingDirection,
  type Rect,
} from '@manga/schema'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react'
import type { Box } from './bubble-shape'
import { type PagePoint, panelAt, panelBox, panelPolygon } from './hit-test'
import {
  type Cut,
  createPanelPatch,
  cutPanelPatch,
  draftRect,
  fitBubblesPatch,
  type Handle,
  mergePanelsPatch,
  moveVertex,
  reshapePanelPatch,
  resizePanelPatch,
  resizeRect,
  type SplitAxis,
  snapCut,
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
  /** パンやピンチの最中。進行中の操作を取り消し、新しい操作も始めない */
  panning: boolean
  tool: Tool
  direction: ReadingDirection
  selection: Selection
  onChange(patch: Patch): void
  onSelect(sel: Selection): void
}

/**
 * ドラッグ中に描くもの。outline は作成、リサイズ、頂点の移動の後の輪郭（ページ座標）で、
 * panelId があればそのコマの変形、無ければ新しいコマ。cut は panelId のコマを割る線
 */
export type Draft =
  | { kind: 'outline'; outline: Point[]; panelId?: ID }
  | { kind: 'cut'; cut: Cut; panelId: ID }

type Pos = { x: number; y: number }

type Gesture =
  | { kind: 'create'; pointerId: number; from: Pos; client: Pos; dragging: boolean }
  | { kind: 'resize'; pointerId: number; panelId: ID; handle: Handle; start: Rect }
  | { kind: 'vertex'; pointerId: number; panelId: ID; index: number }
  | { kind: 'cut'; pointerId: number; panelId: ID; from: Pos; client: Pos; dragging: boolean }
  | { kind: 'merge'; pointerId: number; targetId: ID; client: Pos }

/** 矩形のコマの隅のハンドルと、panelOutline の頂点の番号の対応 */
const CORNER_INDEX: Partial<Record<Handle, number>> = { nw: 0, ne: 1, se: 2, sw: 3 }

/** ハンドルの一辺。viewBox の幅に対する比率なので、ズームしても画面上の大きさが変わらない */
export const HANDLE_RATIO = 0.018

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

/** 点 p で掴める頂点の番号。ハンドルと同じく描いた大きさの倍まで掴める */
function vertexAt(outline: readonly PagePoint[], p: PagePoint, size: number): number | undefined {
  const i = outline.findIndex((v) => Math.abs(p.x - v.x) <= size && Math.abs(p.y - v.y) <= size)
  return i < 0 ? undefined : i
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
 * 選択中のコマはハンドルのドラッグでリサイズし、`toggleMerge` の後か Shift を押しながら別のコマを押すと
 * そのコマと結合する。
 * 多角形のコマは頂点のドラッグで頂点を動かし、矩形のコマも Alt を押しながら隅を引けば頂点を動かす。
 * 縦横の分割は `split` で行う。`startCut` の後か Alt を押しながらのドラッグで線を引くと、
 * 選択中のコマをその線で割る（縦横に近い線はそろえる）。ドラッグ中は `draft` を描くだけで、
 * Patch は pointerup で 1 回だけ出す。形の変わったコマのフキダシは、overflow でない限り新しい枠に収める。
 * 動かずに離したときは何もせず、クリックの選択は useSelection に任せる。Escape でドラッグと線の分割、結合を取り消す
 */
export function usePanelTool(opts: Options) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [cutFor, setCutFor] = useState<ID | null>(null)
  const [mergeFor, setMergeFor] = useState<ID | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const active = opts.tool === 'panel'
  const selectedId = opts.selection?.kind === 'panel' ? opts.selection.id : undefined
  const selected = active ? opts.page.panels.find((p) => p.id === selectedId) : undefined
  const cutting = selected !== undefined && cutFor === selected.id
  const merging = selected !== undefined && mergeFor === selected.id
  const handleSize = opts.view.w * HANDLE_RATIO
  const commit = (patch: Patch) => {
    if (patch.length > 0) opts.onChange(fitBubblesPatch(patch, { w: opts.width, h: opts.height }))
  }

  const pointAt = (e: ReactPointerEvent<SVGSVGElement>) => {
    const mm = clientToPage(opts.view, boxOf(e.currentTarget), { x: e.clientX, y: e.clientY })
    return mm && { mm, n: { x: mm.x / opts.width, y: mm.y / opts.height } }
  }
  const cutOf = (from: Pos, to: Pos) => snapCut({ from, to }, opts.width, opts.height)
  /** リサイズか頂点の移動で点 p まで引いたときのコマの輪郭 */
  const reshaped = (g: Extract<Gesture, { kind: 'resize' | 'vertex' }>, p: Pos): Point[] => {
    if (g.kind === 'vertex') return moveVertex(opts.page, g.panelId, g.index, p)
    const shape = opts.page.panels.find((q) => q.id === g.panelId)?.shape
    return panelOutline({ rect: resizeRect(opts.page, g.panelId, g.start, g.handle, p), shape })
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
      if (!active || opts.panning || gesture.current !== null) return
      if (e.defaultPrevented || e.button !== 0 || e.isPrimary === false) return
      const at = pointAt(e)
      if (at === null) return
      const client = { x: e.clientX, y: e.clientY }
      if (selected) {
        // 結合モードでは隣のコマとの境目を押しても、選択中のコマのハンドルより結合を優先する
        if (e.shiftKey || merging) {
          const target = panelAt(opts.page, opts.width, opts.height, at.mm)
          if (target && target.id !== selected.id) {
            take(e, { kind: 'merge', pointerId: e.pointerId, targetId: target.id, client })
            return
          }
        }
        const handle = handleAt(panelBox(selected, opts.width, opts.height), at.mm, handleSize)
        const vertex = selected.shape
          ? vertexAt(panelPolygon(selected, opts.width, opts.height), at.mm, handleSize)
          : e.altKey && handle !== undefined
            ? CORNER_INDEX[handle]
            : undefined
        if (vertex !== undefined && !cutting && !merging) {
          take(e, { kind: 'vertex', pointerId: e.pointerId, panelId: selected.id, index: vertex })
          setDraft({ kind: 'outline', outline: panelOutline(selected), panelId: selected.id })
          return
        }
        if (cutting || e.altKey) {
          take(e, {
            kind: 'cut',
            pointerId: e.pointerId,
            panelId: selected.id,
            from: at.n,
            client,
            dragging: false,
          })
          return
        }
        if (handle) {
          take(e, {
            kind: 'resize',
            pointerId: e.pointerId,
            panelId: selected.id,
            handle,
            start: selected.rect,
          })
          setDraft({ kind: 'outline', outline: panelOutline(selected), panelId: selected.id })
          return
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
      if (!g) return
      if (opts.panning) {
        end()
        return
      }
      if (g.pointerId !== e.pointerId) return
      if (g.kind === 'resize' || g.kind === 'vertex') {
        const at = pointAt(e)
        if (at === null) return
        setDraft({ kind: 'outline', outline: reshaped(g, at.n), panelId: g.panelId })
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
      if (g.kind === 'cut') {
        setDraft({ kind: 'cut', cut: cutOf(g.from, at.n), panelId: g.panelId })
        return
      }
      setDraft({
        kind: 'outline',
        outline: panelOutline({ rect: draftRect(opts.page, g.from, at.n) }),
      })
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
      if (g.kind === 'merge') {
        if (selectedId === undefined) return
        const patch = mergePanelsPatch(opts.page, selectedId, g.targetId, opts.direction)
        // 結合できない相手なら、モードを残して別のコマを選び直せるようにする
        if (patch.length > 0) setMergeFor(null)
        commit(patch)
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
      if (g.kind === 'cut') {
        if (!g.dragging) return
        setCutFor(null)
        const patch = cutPanelPatch(opts.page, g.panelId, cutOf(g.from, at.n), opts.direction)
        commit(patch)
        return
      }
      const patch =
        g.kind === 'resize'
          ? resizePanelPatch(
              opts.page,
              g.panelId,
              resizeRect(opts.page, g.panelId, g.start, g.handle, at.n),
            )
          : reshapePanelPatch(opts.page, g.panelId, reshaped(g, at.n))
      commit(patch)
    },
    onPointerCancel(e: ReactPointerEvent<SVGSVGElement>) {
      if (gesture.current?.pointerId === e.pointerId) end()
    },
    /** ドラッグ中か線の分割中か結合中の Escape を取り消しとして受けたら true。そのときは選択解除をさせない */
    onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>): boolean {
      if (e.key !== 'Escape' || (gesture.current === null && !cutting && !merging)) return false
      e.preventDefault()
      end()
      setCutFor(null)
      setMergeFor(null)
      return true
    },
  }

  /** 選択中のコマを割る */
  const split = (axis: SplitAxis) => {
    if (!selected) return
    const patch = splitPanelPatch(opts.page, selected.id, axis, opts.direction)
    commit(patch)
  }

  /** 選択中のコマを線で割るモードの切り替え。次のドラッグで引いた線で割る */
  const toggleCut = () => {
    setMergeFor(null)
    setCutFor(cutting || !selected ? null : selected.id)
  }

  /** 選択中のコマと次に押したコマを結合するモードの切り替え */
  const toggleMerge = () => {
    setCutFor(null)
    setMergeFor(merging || !selected ? null : selected.id)
  }

  return {
    draft: active ? draft : null,
    selected,
    handleSize,
    cutting,
    merging,
    split,
    toggleCut,
    toggleMerge,
    handlers,
  }
}
