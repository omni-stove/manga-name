import {
  type FocusKind,
  type FocusPoint,
  type ID,
  newId,
  type Page,
  type Panel,
  type Patch,
  type Point,
  type Vector,
} from '@manga/schema'
import { inBubble, type PagePoint, panelAt, panelBox } from './hit-test'
import type { View } from './view'

/** weight 1 の焦点の描画半径（mm） */
const FOCUS_RADIUS = 10
const DEFAULT_WEIGHT = 0.5
/** 焦点とベクトルを掴める距離。viewBox の幅に対する比率なので、ズームしても画面上の距離が変わらない */
const HIT_RATIO = 0.012

/** `hintAt` と `anchorAt` に渡す、掴める距離（mm） */
export const hintTolerance = (view: View) => view.w * HIT_RATIO

export const focusRadius = (weight: number) => FOCUS_RADIUS * weight

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
// 割り算で 0.30000000000000004 のような値を残さない
const round = (v: number) => Math.round(v * 1000) / 1000

/** ページ座標（mm）の点をコマ内座標にする。コマの外は 0..1 に収める */
export function toPanelPoint(panel: Panel, width: number, height: number, p: PagePoint): Point {
  const box = panelBox(panel, width, height)
  return {
    x: round(clamp01(box.w > 0 ? (p.x - box.x) / box.w : 0)),
    y: round(clamp01(box.h > 0 ? (p.y - box.y) / box.h : 0)),
  }
}

/** コマ内座標をページ座標（mm）にする */
export function toPagePoint(panel: Panel, width: number, height: number, p: Point): PagePoint {
  const box = panelBox(panel, width, height)
  return { x: box.x + p.x * box.w, y: box.y + p.y * box.h }
}

/** 焦点かベクトルの位置。panelIndex と index はページ root からの配列の添字 */
export interface HintLocation {
  panel: Panel
  panelIndex: number
  index: number
}

export function findFocus(page: Page, id: ID): HintLocation | undefined {
  for (const [panelIndex, panel] of page.panels.entries()) {
    const index = panel.focusPoints.findIndex((f) => f.id === id)
    if (index >= 0) return { panel, panelIndex, index }
  }
  return undefined
}

export function findVector(page: Page, id: ID): HintLocation | undefined {
  for (const [panelIndex, panel] of page.panels.entries()) {
    const index = panel.vectors.findIndex((v) => v.id === id)
    if (index >= 0) return { panel, panelIndex, index }
  }
  return undefined
}

function segmentDistance(p: PagePoint, a: PagePoint, b: PagePoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

const sortedPanels = (page: Page) => [...page.panels].sort((a, b) => b.order - a.order)

function focusAt(
  panel: Panel,
  width: number,
  height: number,
  p: PagePoint,
  tolerance: number,
): FocusPoint | undefined {
  return panel.focusPoints.find((f) => {
    const c = toPagePoint(panel, width, height, f.pos)
    return Math.hypot(p.x - c.x, p.y - c.y) <= Math.max(focusRadius(f.weight), tolerance)
  })
}

/**
 * ページ座標の点にある焦点かベクトル。焦点はベクトルの端に重なるので焦点を優先する。
 * tolerance は掴める距離（mm）で、小さい焦点と細い矢印もこの距離までは拾う。何も無ければ null
 */
export function hintAt(
  page: Page,
  width: number,
  height: number,
  p: PagePoint,
  tolerance: number,
): { kind: 'focus' | 'vector'; id: ID } | null {
  const panels = sortedPanels(page)
  for (const panel of panels) {
    const focus = focusAt(panel, width, height, p, tolerance)
    if (focus) return { kind: 'focus', id: focus.id }
  }
  for (const panel of panels) {
    const vector = panel.vectors.find(
      (v) =>
        segmentDistance(
          p,
          toPagePoint(panel, width, height, v.from),
          toPagePoint(panel, width, height, v.to),
        ) <= tolerance,
    )
    if (vector) return { kind: 'vector', id: vector.id }
  }
  return null
}

/**
 * ベクトルの端が乗っている焦点かフキダシの ID。焦点を優先する。
 * PanelSchema が参照先をコマ内に限るので、そのコマの中だけを見る
 */
function anchorAt(
  panel: Panel,
  width: number,
  height: number,
  p: PagePoint,
  tolerance: number,
): ID | undefined {
  const focus = focusAt(panel, width, height, p, tolerance)
  if (focus) return focus.id
  const box = panelBox(panel, width, height)
  return [...panel.bubbles].sort((a, b) => b.order - a.order).find((b) => inBubble(b, box, p))?.id
}

/** コマ内座標の点 pos に kind の焦点を置く Patch と、その ID。コマが無ければ null */
export function createFocusPatch(
  page: Page,
  panelId: ID,
  pos: Point,
  kind: FocusKind,
): { patch: Patch; id: ID } | null {
  const i = page.panels.findIndex((p) => p.id === panelId)
  if (i < 0) return null
  const focus: FocusPoint = {
    id: newId(),
    kind,
    label: '',
    pos: { x: round(clamp01(pos.x)), y: round(clamp01(pos.y)) },
    weight: DEFAULT_WEIGHT,
  }
  return { patch: [{ op: 'add', path: `/panels/${i}/focusPoints/-`, value: focus }], id: focus.id }
}

/** 焦点 focusId に繋がったベクトルの端を (dx, dy) ずらした from と to。コマ内座標 */
export function shiftLinked(
  vector: Vector,
  focusId: ID,
  dx: number,
  dy: number,
): { from: Point; to: Point } {
  const shift = (p: Point, linked: boolean) =>
    linked ? { x: round(clamp01(p.x + dx)), y: round(clamp01(p.y + dy)) } : p
  return {
    from: shift(vector.from, vector.sourceFocusId === focusId),
    to: shift(vector.to, vector.targetFocusId === focusId),
  }
}

/**
 * 焦点をコマ内座標 pos へ動かす Patch。その焦点を始点や終点にしているベクトルの端も同じだけ動かし、
 * 焦点から外れないようにする。動かなければ空
 */
export function moveFocusPatch(page: Page, focusId: ID, pos: Point): Patch {
  const at = findFocus(page, focusId)
  const focus = at?.panel.focusPoints[at.index]
  if (!at || !focus) return []
  const to = { x: round(clamp01(pos.x)), y: round(clamp01(pos.y)) }
  if (to.x === focus.pos.x && to.y === focus.pos.y) return []
  const base = `/panels/${at.panelIndex}`
  const patch: Patch = [{ op: 'replace', path: `${base}/focusPoints/${at.index}/pos`, value: to }]
  const dx = to.x - focus.pos.x
  const dy = to.y - focus.pos.y
  for (const [j, vector] of at.panel.vectors.entries()) {
    const shifted = shiftLinked(vector, focusId, dx, dy)
    if (shifted.from !== vector.from) {
      patch.push({ op: 'replace', path: `${base}/vectors/${j}/from`, value: shifted.from })
    }
    if (shifted.to !== vector.to) {
      patch.push({ op: 'replace', path: `${base}/vectors/${j}/to`, value: shifted.to })
    }
  }
  return patch
}

/**
 * ページ座標の from から to へのベクトルを作る Patch と、その ID。コマは始点で決め、終点はそのコマに収める。
 * 始点と終点が焦点かフキダシの上なら `sourceFocusId` と `targetFocusId` を付ける。両端が同じ要素なら始点の参照は付けない。
 * 始点がコマの外か、長さが 0 なら null
 */
export function createVectorPatch(
  page: Page,
  width: number,
  height: number,
  from: PagePoint,
  to: PagePoint,
  tolerance: number,
): { patch: Patch; id: ID } | null {
  const panel = panelAt(page, width, height, from)
  if (!panel) return null
  const a = toPanelPoint(panel, width, height, from)
  const b = toPanelPoint(panel, width, height, to)
  if (a.x === b.x && a.y === b.y) return null
  const target = anchorAt(panel, width, height, toPagePoint(panel, width, height, b), tolerance)
  const source = anchorAt(panel, width, height, from, tolerance)
  const vector: Vector = {
    id: newId(),
    kind: 'gaze',
    from: a,
    to: b,
    strength: 'strong',
    ...(source !== undefined && source !== target ? { sourceFocusId: source } : {}),
    ...(target !== undefined ? { targetFocusId: target } : {}),
  }
  const i = page.panels.indexOf(panel)
  return { patch: [{ op: 'add', path: `/panels/${i}/vectors/-`, value: vector }], id: vector.id }
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
  const W = 182
  const H = 257
  const panel = (id: string) => page.panels.find((p) => p.id === id) as Panel
  /** コマ panelId のコマ内座標をページ座標にする */
  const at = (panelId: string, x: number, y: number) => toPagePoint(panel(panelId), W, H, { x, y })

  test('hintTolerance is a fixed share of the view width', () => {
    expect(hintTolerance({ x: 0, y: 0, w: 100, h: 50 })).toBeCloseTo(1.2)
    expect(hintTolerance({ x: 0, y: 0, w: 50, h: 50 })).toBeCloseTo(0.6)
  })

  test('toPanelPoint inverts toPagePoint, rounds, and clamps points outside the panel', () => {
    const pn2 = panel('pn_2')
    const corner = toPagePoint(pn2, W, H, { x: 0, y: 1 })
    expect(corner.x).toBeCloseTo(91)
    expect(corner.y).toBeCloseTo(0.505 * H)
    expect(toPanelPoint(pn2, W, H, toPagePoint(pn2, W, H, { x: 0.3, y: 0.7 }))).toEqual({
      x: 0.3,
      y: 0.7,
    })
    expect(toPanelPoint(pn2, W, H, { x: 0, y: H })).toEqual({ x: 0, y: 1 })
    const flat = { ...pn2, rect: { ...pn2.rect, w: 0, h: 0 } }
    expect(toPanelPoint(flat, W, H, { x: 120, y: 90 })).toEqual({ x: 0, y: 0 })
  })

  test('findFocus and findVector return indexes from the page root, or undefined', () => {
    expect(findFocus(page, 'fp_2_vial')).toEqual({ panel: panel('pn_2'), panelIndex: 1, index: 1 })
    expect(findVector(page, 'vc_4_c')).toEqual({ panel: panel('pn_4'), panelIndex: 3, index: 2 })
    expect(findFocus(page, 'vc_4_c')).toBeUndefined()
    expect(findVector(page, 'missing')).toBeUndefined()
  })

  describe('hintAt', () => {
    test('picks a focus within its radius, even on the end of a vector', () => {
      // vc_1_a の終点 (0.31, 0.78) は半径 2mm の fp_1_e の中
      expect(hintAt(page, W, H, at('pn_1', 0.31, 0.78), 0.5)).toEqual({
        kind: 'focus',
        id: 'fp_1_e',
      })
      // 半径 5mm の fp_1_forest の縁の内側
      const c = at('pn_1', 0.65, 0.35)
      expect(hintAt(page, W, H, { x: c.x + 4.9, y: c.y }, 0.5)).toEqual({
        kind: 'focus',
        id: 'fp_1_forest',
      })
    })

    test('a small focus is still caught within the tolerance', () => {
      const c = at('pn_1', 0.3, 0.78)
      const p = { x: c.x, y: c.y - 3 }
      expect(hintAt(page, W, H, p, 2)?.kind).not.toBe('focus')
      expect(hintAt(page, W, H, p, 3.1)).toEqual({ kind: 'focus', id: 'fp_1_e' })
    })

    test('picks a vector within the tolerance of its segment', () => {
      const mid = at('pn_1', 0.365, 0.78)
      expect(hintAt(page, W, H, { x: mid.x, y: mid.y + 0.9 }, 1)).toEqual({
        kind: 'vector',
        id: 'vc_1_a',
      })
      expect(hintAt(page, W, H, { x: mid.x, y: mid.y + 1.1 }, 1)).toBeNull()
    })

    test('returns null away from every hint', () => {
      expect(hintAt(page, W, H, at('pn_1', 0.1, 0.1), 1)).toBeNull()
      expect(hintAt(page, W, H, { x: -10, y: -10 }, 1)).toBeNull()
    })
  })

  test('createFocusPatch appends a default focus with a clamped, rounded position', () => {
    const created = createFocusPatch(page, 'pn_2', { x: 1.2, y: 1 / 3 }, 'sfx')
    expect(created?.patch).toEqual([
      {
        op: 'add',
        path: '/panels/1/focusPoints/-',
        value: { id: created?.id, kind: 'sfx', label: '', pos: { x: 1, y: 0.333 }, weight: 0.5 },
      },
    ])
    expect(createFocusPatch(page, 'missing', { x: 0, y: 0 }, 'face')).toBeNull()
  })

  test('shiftLinked moves only the ends linked to the focus, and keeps the others as is', () => {
    const vector = panel('pn_1').vectors[2] as Vector
    expect(shiftLinked(vector, 'fp_1_e', 0.1, -0.1)).toEqual({
      from: { x: 0.43, y: 0.6 },
      to: vector.to,
    })
    expect(shiftLinked(vector, 'fp_1_e', 0.1, -0.1).to).toBe(vector.to)
    expect(shiftLinked(vector, 'fp_1_forest', 0.5, 0.7).to).toEqual({ x: 1, y: 1 })
    const unlinked = shiftLinked(vector, 'other', 0.1, 0.1)
    expect(unlinked.from).toBe(vector.from)
    expect(unlinked.to).toBe(vector.to)
  })

  describe('moveFocusPatch', () => {
    test('moves the focus and the ends of the vectors linked to it', () => {
      expect(moveFocusPatch(page, 'fp_2_e', { x: 0.8, y: 0.35 })).toEqual([
        { op: 'replace', path: '/panels/1/focusPoints/0/pos', value: { x: 0.8, y: 0.35 } },
        { op: 'replace', path: '/panels/1/vectors/0/from', value: { x: 0.77, y: 0.38 } },
        { op: 'replace', path: '/panels/1/vectors/1/to', value: { x: 0.83, y: 0.33 } },
        { op: 'replace', path: '/panels/1/vectors/2/to', value: { x: 0.83, y: 0.38 } },
      ])
    })

    test('clamps into the panel, and is empty when nothing moves or the focus is missing', () => {
      expect(moveFocusPatch(page, 'fp_5_e', { x: 1.5, y: -1 })).toEqual([
        { op: 'replace', path: '/panels/4/focusPoints/0/pos', value: { x: 1, y: 0 } },
      ])
      expect(moveFocusPatch(page, 'fp_5_e', { x: 0.62, y: 0.5 })).toEqual([])
      expect(moveFocusPatch(page, 'missing', { x: 0.5, y: 0.5 })).toEqual([])
    })
  })

  describe('createVectorPatch', () => {
    const addedVector = (created: { patch: Patch } | null) => {
      if (!created) throw new Error('no patch')
      return (created.patch[0] as { value: Vector }).value
    }

    test('links both ends to the foci under them', () => {
      const created = createVectorPatch(page, W, H, at('pn_2', 0.75, 0.3), at('pn_2', 0.45, 0.5), 1)
      expect(created?.patch).toEqual([
        {
          op: 'add',
          path: '/panels/1/vectors/-',
          value: {
            id: created?.id,
            kind: 'gaze',
            from: { x: 0.75, y: 0.3 },
            to: { x: 0.45, y: 0.5 },
            strength: 'strong',
            sourceFocusId: 'fp_2_e',
            targetFocusId: 'fp_2_vial',
          },
        },
      ])
    })

    test('links the end to a bubble, and leaves a free start unlinked', () => {
      const created = createVectorPatch(page, W, H, at('pn_3', 0.2, 0.8), at('pn_3', 0.85, 0.25), 1)
      const value = addedVector(created)
      expect(value.targetFocusId).toBe('bb_3')
      expect(value).not.toHaveProperty('sourceFocusId')
    })

    test('drops the source link when both ends are on the same focus', () => {
      const created = createVectorPatch(page, W, H, at('pn_4', 0.42, 0.3), at('pn_4', 0.47, 0.3), 1)
      const value = addedVector(created)
      expect(value.targetFocusId).toBe('fp_4_mask')
      expect(value).not.toHaveProperty('sourceFocusId')
    })

    test('keeps the end inside the start panel', () => {
      const created = createVectorPatch(page, W, H, at('pn_3', 0.2, 0.8), { x: W, y: 0 }, 1)
      expect(created?.patch[0]).toMatchObject({
        path: '/panels/2/vectors/-',
        value: { from: { x: 0.2, y: 0.8 }, to: { x: 1, y: 0 } },
      })
    })

    test('is null when the start is outside every panel or the vector has no length', () => {
      const gap = { x: 0.3 * W, y: 0.268 * H }
      expect(createVectorPatch(page, W, H, gap, at('pn_1', 0.5, 0.5), 1)).toBeNull()
      const p = at('pn_3', 0.2, 0.8)
      expect(createVectorPatch(page, W, H, p, p, 1)).toBeNull()
    })
  })
}
