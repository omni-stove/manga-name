import type { ID, Page, Patch, Point } from '@manga/schema'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useState,
} from 'react'
import { breakoutPatch } from './panel-ops'
import { HANDLE_RATIO } from './use-panel-tool'
import { type ClientBox, clientToPage, type View } from './view'

interface Options {
  page: Page
  /** ページの大きさ（mm） */
  width: number
  height: number
  view: View
  panning: boolean
  /** はみ出しを描いているコマ。null なら何もしない */
  panelId: ID | null
  onChange(patch: Patch): void
  /** 多角形を閉じたか取り消したら呼ぶ */
  onEnd(): void
}

/** 描きかけの多角形。points はページの正規化座標、cursor は次の頂点を置く先 */
export interface BreakoutDraft {
  panelId: ID
  points: Point[]
  cursor: Point | null
}

function boxOf(el: Element): ClientBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * コマ panelId のはみ出し（Panel.breakout）を描く操作。どのツールでも、クリックで頂点を置き、
 * 頂点が 3 つ以上あれば最初の頂点のクリックか Enter で閉じて Patch を 1 回出す。
 * Backspace で最後の頂点を消し、Escape で取り消す。描いている間は他の操作にクリックを渡さない
 */
export function useBreakoutTool(opts: Options) {
  const [state, setState] = useState<BreakoutDraft | null>(null)
  const active = opts.panelId !== null
  const draft: BreakoutDraft | null = !active
    ? null
    : state?.panelId === opts.panelId
      ? state
      : { panelId: opts.panelId as ID, points: [], cursor: null }
  const closeSize = opts.view.w * HANDLE_RATIO

  const pointAt = (e: ReactPointerEvent<SVGSVGElement>): Point | null => {
    const mm = clientToPage(opts.view, boxOf(e.currentTarget), { x: e.clientX, y: e.clientY })
    return mm && { x: mm.x / opts.width, y: mm.y / opts.height }
  }
  const finish = (points: readonly Point[] | null) => {
    if (draft && points) {
      const patch = breakoutPatch(opts.page, draft.panelId, points)
      if (patch.length > 0) opts.onChange(patch)
    }
    setState(null)
    opts.onEnd()
  }
  /** 正規化座標の点 p が最初の頂点を閉じる位置か。掴む範囲は画面上の大きさで決める */
  const closes = (points: readonly Point[], p: Point) => {
    const first = points[0]
    if (!first || points.length < 3) return false
    const dx = (p.x - first.x) * opts.width
    const dy = (p.y - first.y) * opts.height
    return Math.hypot(dx, dy) <= closeSize
  }

  const handlers = {
    onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
      if (!draft || opts.panning || e.button !== 0 || e.isPrimary === false) return
      const p = pointAt(e)
      if (p === null) return
      // 他のフックとパンにクリックとして拾わせない
      e.preventDefault()
      e.currentTarget.focus({ preventScroll: true })
      if (closes(draft.points, p)) {
        finish(draft.points)
        return
      }
      setState({ ...draft, points: [...draft.points, p], cursor: p })
    },
    onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
      if (!draft || draft.points.length === 0) return
      const p = pointAt(e)
      if (p !== null) setState({ ...draft, cursor: p })
    },
    /** 描いている間のキーを受けたら true。そのときは選択の解除や削除をさせない */
    onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>): boolean {
      if (!draft) return false
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
        return true
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (draft.points.length >= 3) finish(draft.points)
        return true
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        setState({ ...draft, points: draft.points.slice(0, -1) })
        return true
      }
      return false
    },
  }

  return { draft, closeSize, handlers }
}
