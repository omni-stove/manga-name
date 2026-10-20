import type { FocusKind, ID, Page, Panel, Patch, Point } from '@manga/schema'
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
  focusWeight,
  hintAt,
  hintTolerance,
  moveFocusPatch,
  toPanelPoint,
} from './hint-ops'
import { type PagePoint, panelAt, panelBox } from './hit-test'
import { rotateFocusPatch, rotationAt, type SfxFrame, sfxFrame, sfxRotateHandle } from './sfx-ops'
import type { Selection, Tool } from './types'
import { HANDLE_RATIO } from './use-panel-tool'
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
  | { kind: 'place'; panelId: ID; focusKind: FocusKind; pos: Point; weight: number }
  | { kind: 'vector'; panelId: ID; from: Point; to: Point }
  | { kind: 'rotate'; focusId: ID; rotation: number }

/** 回転のハンドルを出す、選択中の描き文字。frame はドラッグ中なら回した後の傾き */
export interface SfxRotation {
  focusId: ID
  frame: SfxFrame
  handle: PagePoint
}

type Pos = { x: number; y: number }

type Gesture =
  | {
      kind: 'place'
      pointerId: number
      panelId: ID
      pos: Point
      from: PagePoint
      client: Pos
      dragging: boolean
    }
  | {
      kind: 'move'
      pointerId: number
      focusId: ID
      from: PagePoint
      origin: Point
      client: Pos
      dragging: boolean
    }
  | { kind: 'vector'; pointerId: number; from: PagePoint; client: Pos; dragging: boolean }
  | {
      kind: 'rotate'
      pointerId: number
      focusId: ID
      center: PagePoint
      client: Pos
      dragging: boolean
    }

/**
 * 選択中の描き文字の回転のハンドル。ハンドルは描き文字の上端から handleSize の 2 倍離す。
 * 選択が sfx の焦点でないか、描き文字が無いか、ロックしていれば undefined。ドラッグ中は draft の傾きで出す
 */
function sfxRotation(
  page: Page,
  width: number,
  height: number,
  selection: Selection,
  draft: HintDraft | null,
  handleSize: number,
): SfxRotation | undefined {
  if (selection?.kind !== 'focus') return undefined
  const found = findFocus(page, selection.id)
  const focus = found?.panel.focusPoints[found.index]
  if (!found || !focus || focus.kind !== 'sfx' || focus.label.trim() === '' || focus.locked) {
    return undefined
  }
  const turning = draft?.kind === 'rotate' && draft.focusId === focus.id
  const frame = sfxFrame(
    turning ? { ...focus, rotation: draft.rotation } : focus,
    panelBox(found.panel, width, height),
  )
  return { focusId: focus.id, frame, handle: sfxRotateHandle(frame, handleSize * 2) }
}

function boxOf(el: Element): ClientBox {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/**
 * `focus` と `vector` ツールの操作。
 * `focus` はコマの上のクリックで既定の大きさの、ドラッグで押した点を中心に離した点までを半径にした大きさ
 * （weight）の `focusKind` の焦点を置いて選び、既存の焦点はドラッグで動かす。
 * 位置をロックした焦点は動かさない。選択中の sfx の焦点に描き文字があり、ロックしていなければ、描き文字の上に
 * 回転のハンドルを出し、そのドラッグで描き文字を中心のまわりに傾ける。Shift を押している間は 15 度ずつ傾ける。
 * `vector` はコマの上のドラッグで始点から終点へのベクトルを作って選ぶ。動かずに離したときは何もせず、
 * クリックの選択は useSelection に任せる。
 * ドラッグ中は `draft` を描くだけで、Patch は pointerup で 1 回だけ出す。Escape でドラッグを取り消す
 */
export function useHintTool(opts: Options) {
  const [draft, setDraft] = useState<HintDraft | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const active = opts.enabled && (opts.tool === 'focus' || opts.tool === 'vector')
  const tolerance = hintTolerance(opts.view)
  const handleSize = opts.view.w * HANDLE_RATIO
  const rotation =
    active && opts.tool === 'focus'
      ? sfxRotation(opts.page, opts.width, opts.height, opts.selection, draft, handleSize)
      : undefined

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
  /** 掴んだ点からの差分を焦点の元の位置に足す。中心をポインタに合わせない */
  const movedPos = (g: Extract<Gesture, { kind: 'move' }>, panel: Panel, at: PagePoint): Point => {
    const start = toPanelPoint(panel, opts.width, opts.height, g.from)
    const now = toPanelPoint(panel, opts.width, opts.height, at)
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
    return {
      x: clamp01(g.origin.x + now.x - start.x),
      y: clamp01(g.origin.y + now.y - start.y),
    }
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
        // ハンドルは他の焦点の上にも出るので、先に見る
        if (
          rotation &&
          Math.hypot(at.x - rotation.handle.x, at.y - rotation.handle.y) <= handleSize
        ) {
          take(e, {
            kind: 'rotate',
            pointerId: e.pointerId,
            focusId: rotation.focusId,
            center: { x: rotation.frame.cx, y: rotation.frame.cy },
            client,
            dragging: false,
          })
          return
        }
        const hit = hintAt(opts.page, opts.width, opts.height, at, tolerance)
        const hitFocus = hit?.kind === 'focus' ? findFocus(opts.page, hit.id) : undefined
        if (hit?.kind === 'focus' && hitFocus?.panel.focusPoints[hitFocus.index]?.locked) {
          // ロックした焦点の上には新しい焦点も置かず、クリックの選択だけを useSelection に任せる
          return
        }
        if (hit?.kind === 'focus' && hitFocus) {
          take(e, {
            kind: 'move',
            pointerId: e.pointerId,
            focusId: hit.id,
            from: at,
            origin: hitFocus.panel.focusPoints[hitFocus.index]?.pos ?? { x: 0, y: 0 },
            client,
            dragging: false,
          })
          select(hit)
          return
        }
        const panel = panelAt(opts.page, opts.width, opts.height, at)
        if (!panel) return
        const pos = toPanelPoint(panel, opts.width, opts.height, at)
        take(e, {
          kind: 'place',
          pointerId: e.pointerId,
          panelId: panel.id,
          pos,
          from: at,
          client,
          dragging: false,
        })
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
      if (g.pointerId !== e.pointerId) return
      const moved = Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y)
      if (!g.dragging && moved <= CLICK_SLOP) return
      const at = pointAt(e)
      if (at === null) return
      g.dragging = true
      if (g.kind === 'rotate') {
        setDraft({
          kind: 'rotate',
          focusId: g.focusId,
          rotation: rotationAt(g.center, at, e.shiftKey),
        })
        return
      }
      if (g.kind === 'place') {
        setDraft({
          kind: 'place',
          panelId: g.panelId,
          focusKind: opts.focusKind,
          pos: g.pos,
          weight: focusWeight(Math.hypot(at.x - g.from.x, at.y - g.from.y)),
        })
        return
      }
      if (g.kind === 'move') {
        const panel = findFocus(opts.page, g.focusId)?.panel
        if (!panel) return
        setDraft({
          kind: 'focus',
          focusId: g.focusId,
          pos: movedPos(g, panel, at),
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
        const at = g.dragging ? pointAt(e) : null
        const weight =
          at === null ? undefined : focusWeight(Math.hypot(at.x - g.from.x, at.y - g.from.y))
        const created = createFocusPatch(opts.page, g.panelId, g.pos, opts.focusKind, weight)
        if (!created) return
        opts.onChange(created.patch)
        opts.onSelect({ kind: 'focus', id: created.id })
        return
      }
      if (!g.dragging) return
      const at = pointAt(e)
      if (at === null) return
      if (g.kind === 'rotate') {
        const patch = rotateFocusPatch(opts.page, g.focusId, rotationAt(g.center, at, e.shiftKey))
        if (patch.length > 0) opts.onChange(patch)
        return
      }
      if (g.kind === 'move') {
        const panel = findFocus(opts.page, g.focusId)?.panel
        if (!panel) return
        const pos = movedPos(g, panel, at)
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

  return { draft: active ? draft : null, active, rotation, handleSize, handlers }
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const base = fixtures.samplePage01.episodes[0]?.pages[0] as Page
  const withFocus = (patch: Record<string, unknown>): Page => ({
    ...base,
    panels: base.panels.map((p) => ({
      ...p,
      focusPoints: p.focusPoints.map((f) =>
        f.id === 'fp_2_vial' ? ({ ...f, kind: 'sfx', label: 'ドン', ...patch } as typeof f) : f,
      ),
    })),
  })
  const select: Selection = { kind: 'focus', id: 'fp_2_vial' }

  describe('sfxRotation', () => {
    test('is undefined unless a focus with a label is selected and unlocked', () => {
      const page = withFocus({})
      expect(sfxRotation(page, 210, 297, null, null, 2)).toBeUndefined()
      expect(sfxRotation(page, 210, 297, { kind: 'focus', id: 'missing' }, null, 2)).toBeUndefined()
      expect(sfxRotation(base, 210, 297, select, null, 2)).toBeUndefined()
      expect(sfxRotation(withFocus({ label: ' ' }), 210, 297, select, null, 2)).toBeUndefined()
      expect(sfxRotation(withFocus({ locked: true }), 210, 297, select, null, 2)).toBeUndefined()
    })

    test('uses the draft rotation only for the focus being turned', () => {
      const page = withFocus({ rotation: 10 })
      expect(sfxRotation(page, 210, 297, select, null, 2)?.frame.rotation).toBe(10)
      const turn = (focusId: string): HintDraft => ({ kind: 'rotate', focusId, rotation: 50 })
      expect(sfxRotation(page, 210, 297, select, turn('fp_2_vial'), 2)?.frame.rotation).toBe(50)
      expect(sfxRotation(page, 210, 297, select, turn('other'), 2)?.frame.rotation).toBe(10)
    })
  })
}
