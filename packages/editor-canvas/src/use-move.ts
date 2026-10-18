import { type ID, type Page, type Patch, panelOutline } from '@manga/schema'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react'
import { findBubble, movedBubble, updateBubblePatch } from './bubble-ops'
import { isLocked, movedRect, nudgePatch } from './edit-ops'
import { type PagePoint, panelBox } from './hit-test'
import type { Selection } from './types'
import type { BubbleDraft } from './use-bubble-tool'
import type { Draft } from './use-panel-tool'
import { CLICK_SLOP, sameSelection } from './use-selection'
import { capture } from './use-viewport'
import { type ClientBox, clientToPage, type View } from './view'

interface Options {
  page: Page
  /** ページの大きさ（mm） */
  width: number
  height: number
  view: View
  /** パンやピンチの最中。進行中の移動を取り消し、新しい移動も始めない */
  panning: boolean
  /** `select` ツールのときだけ true */
  active: boolean
  selection: Selection
  /** 押した位置の要素。useSelection の hitAt */
  hitAt(e: ReactMouseEvent<SVGSVGElement>): Selection
  onChange(patch: Patch): void
}

type Gesture = {
  pointerId: number
  target: { kind: 'panel' | 'bubble'; id: ID }
  from: PagePoint
  client: { x: number; y: number }
  dragging: boolean
}

function boxOf(el: Element): ClientBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * `select` ツールで、選択中のコマかフキダシを押したままドラッグして動かす。位置をロックしたものは動かさない。
 * コマはページの中に、フキダシの中心としっぽはコマ内座標の 0..1 に収める。
 * ドラッグ中は移動後の輪郭を `panelDraft` か `bubbleDraft` に出すだけで、Patch は pointerup で 1 回だけ出す。
 * 動かさずに離したときの選択は useSelection に任せる。Escape でドラッグを取り消す
 */
export function useMove(opts: Options) {
  const [panelDraft, setPanelDraft] = useState<Draft | null>(null)
  const [bubbleDraft, setBubbleDraft] = useState<BubbleDraft | null>(null)
  const gesture = useRef<Gesture | null>(null)

  const pointAt = (e: ReactPointerEvent<SVGSVGElement>) =>
    clientToPage(opts.view, boxOf(e.currentTarget), { x: e.clientX, y: e.clientY })
  const end = () => {
    gesture.current = null
    setPanelDraft(null)
    setBubbleDraft(null)
  }
  /** 点 p まで動かしたときの Patch と、描く輪郭 */
  const movedTo = (g: Gesture, p: PagePoint) => {
    if (g.target.kind === 'panel') {
      const panel = opts.page.panels.find((q) => q.id === g.target.id)
      if (!panel) return null
      const dx = (p.x - g.from.x) / opts.width
      const dy = (p.y - g.from.y) / opts.height
      return {
        patch: nudgePatch(opts.page, g.target, dx, dy),
        panelDraft: {
          kind: 'outline',
          outline: panelOutline({ ...panel, rect: movedRect(panel.rect, dx, dy) }),
          panelId: panel.id,
        } satisfies Draft,
        bubbleDraft: null,
      }
    }
    const found = findBubble(opts.page, g.target.id)
    if (!found) return null
    const box = panelBox(found.panel, opts.width, opts.height)
    const bubble = movedBubble(found.bubble, (p.x - g.from.x) / box.w, (p.y - g.from.y) / box.h)
    return {
      patch: updateBubblePatch(opts.page, bubble),
      panelDraft: null,
      bubbleDraft: { bubble, panel: box },
    }
  }

  const handlers = {
    onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
      if (!opts.active || opts.panning || gesture.current !== null) return
      if (e.defaultPrevented || e.button !== 0 || e.isPrimary === false) return
      const sel = opts.selection
      if (sel === null || (sel.kind !== 'panel' && sel.kind !== 'bubble')) return
      if (!sameSelection(opts.hitAt(e), sel) || isLocked(opts.page, sel)) return
      const at = pointAt(e)
      if (at === null) return
      // 動かさずに離せば useSelection のクリックになるよう、preventDefault しない
      capture(e.currentTarget, e.pointerId)
      gesture.current = {
        pointerId: e.pointerId,
        target: { kind: sel.kind, id: sel.id },
        from: at,
        client: { x: e.clientX, y: e.clientY },
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
      if (!g.dragging) {
        if (Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) <= CLICK_SLOP) return
        g.dragging = true
      }
      const at = pointAt(e)
      const moved = at && movedTo(g, at)
      if (!moved) return
      setPanelDraft(moved.panelDraft)
      setBubbleDraft(moved.bubbleDraft)
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
      if (!g.dragging) return
      const at = pointAt(e)
      const moved = at && movedTo(g, at)
      if (moved && moved.patch.length > 0) opts.onChange(moved.patch)
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

  return {
    panelDraft: opts.active ? panelDraft : null,
    bubbleDraft: opts.active ? bubbleDraft : null,
    handlers,
  }
}
