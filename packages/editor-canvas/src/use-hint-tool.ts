import type { FocusKind, ID, Page, Patch, Point } from '@manga/schema'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react'
import {
  createFocusPatch,
  createVectorPatch,
  findFocus,
  hintAt,
  hintTolerance,
  moveFocusPatch,
  toPanelPoint,
} from './hint-ops'
import { type PagePoint, panelAt } from './hit-test'
import type { Selection, Tool } from './types'
import { CLICK_SLOP, sameSelection } from './use-selection'
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
  focusKind: FocusKind
  /** ヒントのレイヤーが見えているか。見えないものは置かせも掴ませもしない */
  enabled: boolean
  selection: Selection
  onChange(patch: Patch): void
  onSelect(sel: Selection): void
}

/** ドラッグ中に描くもの。座標はコマ内座標 */
export type HintDraft =
  | { kind: 'focus'; focusId: ID; pos: Point }
  | { kind: 'vector'; panelId: ID; from: Point; to: Point }

type Pos = { x: number; y: number }

type Gesture =
  | { kind: 'place'; pointerId: number; panelId: ID; pos: Point; client: Pos }
  | { kind: 'move'; pointerId: number; focusId: ID; client: Pos; dragging: boolean }
  | { kind: 'vector'; pointerId: number; from: PagePoint; client: Pos; dragging: boolean }

function boxOf(el: Element): ClientBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * `focus` と `vector` ツールの操作。
 * `focus` はコマの上のクリックで `focusKind` の焦点を置いて選び、既存の焦点はドラッグで動かす。
 * `vector` はコマの上のドラッグで始点から終点へのベクトルを作って選ぶ。動かずに離したときは何もせず、
 * クリックの選択は useSelection に任せる。
 * ドラッグ中は `draft` を描くだけで、Patch は pointerup で 1 回だけ出す。Escape でドラッグを取り消す
 */
export function useHintTool(opts: Options) {
  const [draft, setDraft] = useState<HintDraft | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const active = opts.enabled && (opts.tool === 'focus' || opts.tool === 'vector')
  const tolerance = hintTolerance(opts.view)

  const pointAt = (e: ReactPointerEvent<SVGSVGElement>) =>
    clientToPage(opts.view, boxOf(e.currentTarget), { x: e.clientX, y: e.clientY })
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
  const select = (sel: Selection) => {
    if (!sameSelection(sel, opts.selection)) opts.onSelect(sel)
  }

  const handlers = {
    onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
      if (!active || opts.panning || gesture.current !== null) return
      if (e.defaultPrevented || e.button !== 0 || e.isPrimary === false) return
      const at = pointAt(e)
      if (at === null) return
      const client = { x: e.clientX, y: e.clientY }
      if (opts.tool === 'focus') {
        const hit = hintAt(opts.page, opts.width, opts.height, at, tolerance)
        if (hit?.kind === 'focus') {
          take(e, {
            kind: 'move',
            pointerId: e.pointerId,
            focusId: hit.id,
            client,
            dragging: false,
          })
          select(hit)
          return
        }
        const panel = panelAt(opts.page, opts.width, opts.height, at)
        if (!panel) return
        const pos = toPanelPoint(panel, opts.width, opts.height, at)
        take(e, { kind: 'place', pointerId: e.pointerId, panelId: panel.id, pos, client })
        return
      }
      if (!panelAt(opts.page, opts.width, opts.height, at)) return
      capture(e.currentTarget, e.pointerId)
      gesture.current = {
        kind: 'vector',
        pointerId: e.pointerId,
        from: at,
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
      if (g.pointerId !== e.pointerId || g.kind === 'place') return
      const moved = Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y)
      if (!g.dragging && moved <= CLICK_SLOP) return
      const at = pointAt(e)
      if (at === null) return
      g.dragging = true
      if (g.kind === 'move') {
        const panel = findFocus(opts.page, g.focusId)?.panel
        if (!panel) return
        setDraft({
          kind: 'focus',
          focusId: g.focusId,
          pos: toPanelPoint(panel, opts.width, opts.height, at),
        })
        return
      }
      const panel = panelAt(opts.page, opts.width, opts.height, g.from)
      if (!panel) return
      setDraft({
        kind: 'vector',
        panelId: panel.id,
        from: toPanelPoint(panel, opts.width, opts.height, g.from),
        to: toPanelPoint(panel, opts.width, opts.height, at),
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
      if (g.kind === 'place') {
        if (Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) > CLICK_SLOP) return
        const created = createFocusPatch(opts.page, g.panelId, g.pos, opts.focusKind)
        if (!created) return
        opts.onChange(created.patch)
        opts.onSelect({ kind: 'focus', id: created.id })
        return
      }
      if (!g.dragging) return
      const at = pointAt(e)
      if (at === null) return
      if (g.kind === 'move') {
        const panel = findFocus(opts.page, g.focusId)?.panel
        if (!panel) return
        const pos = toPanelPoint(panel, opts.width, opts.height, at)
        const patch = moveFocusPatch(opts.page, g.focusId, pos)
        if (patch.length > 0) opts.onChange(patch)
        return
      }
      const created = createVectorPatch(opts.page, opts.width, opts.height, g.from, at, tolerance)
      if (!created) return
      opts.onChange(created.patch)
      opts.onSelect({ kind: 'vector', id: created.id })
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

  return { draft: active ? draft : null, active, handlers }
}
