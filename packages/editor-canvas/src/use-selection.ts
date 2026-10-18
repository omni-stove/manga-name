import type { Page, Patch } from '@manga/schema'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react'
import { NUDGE_SHIFT_FACTOR, NUDGE_STEP, nudgePatch, removePatch } from './edit-ops'
import { hintAt, hintTolerance } from './hint-ops'
import { hitTest } from './hit-test'
import type { Selection } from './types'
import { type ClientBox, clientToPage, type View } from './view'

interface Options {
  page: Page
  /** ページの大きさ（mm） */
  width: number
  height: number
  view: View
  /** パンやピンチの最中。ホバーもクリックも拾わない */
  panning: boolean
  /** 焦点とベクトルを拾うか。ヒントのレイヤーが見えているときだけ true */
  hints: boolean
  selection: Selection
  onChange(patch: Patch): void
  onSelect(sel: Selection): void
}

/** 画面座標とその座標を測るキャンバス。マウスやポインターのイベントもそのまま渡せる */
export type ClientPoint = Pick<
  ReactMouseEvent<SVGSVGElement>,
  'currentTarget' | 'clientX' | 'clientY'
>

/** 押した位置から動いてもクリックとみなす画面 px */
export const CLICK_SLOP = 4

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

export const sameSelection = (a: Selection, b: Selection) =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id)

function boxOf(el: Element): ClientBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * クリックで選択、ホバーで強調（`hints` のときは焦点とベクトルをフキダシより先に拾う）、
 * Delete / Backspace で削除、矢印キーで移動（Shift で 10 倍）、
 * Escape で選択解除。クリックは pointerdown から動かずに pointerup したときだけで、
 * ズームやパンに使われた pointerdown（preventDefault 済み）は無視する。
 * キーはキャンバス自身にフォーカスがあるときだけ受ける
 */
export function useSelection(opts: Options) {
  const [hovered, setHovered] = useState<Selection>(null)
  const pending = useRef<{ pointerId: number; x: number; y: number } | null>(null)

  const hitAt = (e: ClientPoint): Selection => {
    const p = clientToPage(opts.view, boxOf(e.currentTarget), { x: e.clientX, y: e.clientY })
    if (p === null) return null
    const hint = opts.hints
      ? hintAt(opts.page, opts.width, opts.height, p, hintTolerance(opts.view))
      : null
    return hint ?? hitTest(opts.page, opts.width, opts.height, p)
  }
  const hover = (next: Selection) => {
    if (!sameSelection(next, hovered)) setHovered(next)
  }

  const handlers = {
    onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
      if (e.defaultPrevented || e.button !== 0 || e.isPrimary === false) {
        pending.current = null
        return
      }
      e.currentTarget.focus({ preventScroll: true })
      pending.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY }
    },
    onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
      const p = pending.current
      if (
        p &&
        p.pointerId === e.pointerId &&
        Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP
      ) {
        pending.current = null
      }
      if (opts.panning) hover(null)
      else hover(hitAt(e))
    },
    onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
      const p = pending.current
      if (!p || p.pointerId !== e.pointerId) return
      pending.current = null
      const hit = hitAt(e)
      if (!sameSelection(hit, opts.selection)) opts.onSelect(hit)
    },
    onPointerCancel() {
      pending.current = null
    },
    onPointerLeave() {
      hover(null)
    },
    onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>) {
      // 生成ボタンなど中のフォーカス可能な要素のキーは奪わない
      if (e.target !== e.currentTarget) return
      if (e.key === 'Escape') {
        if (opts.selection !== null) opts.onSelect(null)
        return
      }
      const hintSelected = opts.selection?.kind === 'focus' || opts.selection?.kind === 'vector'
      if (hintSelected && !opts.hints) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const patch = removePatch(opts.page, opts.selection)
        if (patch.length === 0) return
        e.preventDefault()
        opts.onChange(patch)
        opts.onSelect(null)
        return
      }
      const arrow = ARROWS[e.key]
      if (!arrow || e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      const step = e.shiftKey ? NUDGE_STEP * NUDGE_SHIFT_FACTOR : NUDGE_STEP
      const patch = nudgePatch(opts.page, opts.selection, arrow[0] * step, arrow[1] * step)
      if (patch.length > 0) opts.onChange(patch)
    },
  }

  return { hovered, hitAt, handlers }
}
