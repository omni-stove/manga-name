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
export const FOCUS_RADIUS = 10
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
export function anchorAt(
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
  const patch: Patch = [
    { op: 'replace', path: `${base}/focusPoints/${at.index}/pos`, value: to },
  ]
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
