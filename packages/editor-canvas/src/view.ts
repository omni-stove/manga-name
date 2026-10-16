/**
 * キャンバスの座標系。SVG のユーザー単位はページの mm（`pageSize`）で、正規化座標に
 * `pageSize.w` / `pageSize.h` を掛けたものになる。ズームとパンは viewBox の差し替えで表す。
 */

/** SVG の viewBox。ページ座標（mm） */
export interface View {
  x: number
  y: number
  w: number
  h: number
}

/** SVG 要素の画面上の矩形。getBoundingClientRect の値 */
export interface ClientBox {
  left: number
  top: number
  width: number
  height: number
}

interface ClientPoint {
  x: number
  y: number
}

/** ページの周りに空ける余白。ページの長辺に対する比率 */
const FIT_MARGIN = 0.04
const MIN_ZOOM = 0.25
const MAX_ZOOM = 8
/** ホイール 1px あたりのズーム。トラックパッドのピンチは ctrlKey 付きで細かい delta が来るので大きくする */
const WHEEL_SENSITIVITY = 0.002
const PINCH_WHEEL_SENSITIVITY = 0.01
const LINE_PX = 16
const PAGE_PX = 800

/** ページ全体が余白付きで収まる View。ズーム 1 の基準 */
export function fitView(pageW: number, pageH: number): View {
  const m = Math.max(pageW, pageH) * FIT_MARGIN
  return { x: -m, y: -m, w: pageW + m * 2, h: pageH + m * 2 }
}

/** base に対する倍率 */
export function zoomOf(view: View, base: View): number {
  return base.w / view.w
}

/**
 * ユーザー単位 1 あたりの画面 px。`preserveAspectRatio="xMidYMid meet"` の拡大率。
 * 要素の大きさが 0（レイアウト前）なら null
 */
function scaleOf(view: View, box: ClientBox): number | null {
  const s = Math.min(box.width / view.w, box.height / view.h)
  return Number.isFinite(s) && s > 0 ? s : null
}

/** 画面座標をページ座標（mm）にする。要素の大きさが 0 なら null */
function clientToPage(view: View, box: ClientBox, p: ClientPoint): ClientPoint | null {
  const s = scaleOf(view, box)
  if (s === null) return null
  const ox = (box.width - view.w * s) / 2
  const oy = (box.height - view.h * s) / 2
  return { x: view.x + (p.x - box.left - ox) / s, y: view.y + (p.y - box.top - oy) / s }
}

/** 画面上の点 at を動かさずに factor 倍ズームする。倍率は MIN_ZOOM..MAX_ZOOM に収める */
export function zoomAt(
  view: View,
  base: View,
  box: ClientBox,
  at: ClientPoint,
  factor: number,
): View {
  const anchor = clientToPage(view, box, at)
  if (anchor === null || !(factor > 0)) return view
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomOf(view, base) * factor))
  const w = base.w / zoom
  const h = base.h / zoom
  const k = w / view.w
  return { x: anchor.x - (anchor.x - view.x) * k, y: anchor.y - (anchor.y - view.y) * k, w, h }
}

/** 画面上で (dx, dy) px ドラッグしたぶん、ページを動かす */
export function panBy(view: View, box: ClientBox, dx: number, dy: number): View {
  const s = scaleOf(view, box)
  if (s === null) return view
  return { ...view, x: view.x - dx / s, y: view.y - dy / s }
}

/**
 * 2 本指の始点と現在の位置から View を出す。指の間隔の比でズームし、中点の移動でパンする。
 * 途中の View から積み上げず、毎回 start から計算するので誤差が溜まらない
 */
export function pinchView(
  start: View,
  base: View,
  box: ClientBox,
  from: [ClientPoint, ClientPoint],
  to: [ClientPoint, ClientPoint],
): View {
  const d0 = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y)
  const d1 = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y)
  const m0 = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 }
  const m1 = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 }
  const zoomed = d0 > 0 ? zoomAt(start, base, box, m0, d1 / d0) : start
  return panBy(zoomed, box, m1.x - m0.x, m1.y - m0.y)
}

/** WheelEvent をズーム倍率にする。下に回すと縮小 */
export function wheelFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1
  const sensitivity = e.ctrlKey ? PINCH_WHEEL_SENSITIVITY : WHEEL_SENSITIVITY
  return Math.exp(-e.deltaY * unit * sensitivity)
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest

  const base = fitView(182, 257)
  // base と同じ縦横比の要素。拡大率は 2px / mm
  const box: ClientBox = { left: 10, top: 20, width: base.w * 2, height: base.h * 2 }

  test('fitView contains the page with a margin', () => {
    expect(base.x).toBeLessThan(0)
    expect(base.y).toBeLessThan(0)
    expect(base.x + base.w).toBeGreaterThan(182)
    expect(base.y + base.h).toBeGreaterThan(257)
  })

  test('clientToPage maps the element corners and handles letterboxing', () => {
    expect(clientToPage(base, box, { x: 10, y: 20 })).toEqual({ x: base.x, y: base.y })
    const wide = { ...box, width: box.width + 100 }
    expect(clientToPage(base, wide, { x: 60, y: 20 })).toEqual({ x: base.x, y: base.y })
    expect(clientToPage(base, { ...box, width: 0 }, { x: 0, y: 0 })).toBeNull()
  })

  describe('zoomAt', () => {
    test('keeps the anchor point fixed on screen', () => {
      const at = { x: 150, y: 300 }
      const before = clientToPage(base, box, at)
      const zoomed = zoomAt(base, base, box, at, 2)
      expect(zoomOf(zoomed, base)).toBeCloseTo(2)
      const after = clientToPage(zoomed, box, at)
      expect(after?.x).toBeCloseTo(before?.x ?? Number.NaN)
      expect(after?.y).toBeCloseTo(before?.y ?? Number.NaN)
    })

    test('clamps to MIN_ZOOM..MAX_ZOOM', () => {
      expect(zoomOf(zoomAt(base, base, box, { x: 0, y: 0 }, 100), base)).toBeCloseTo(MAX_ZOOM)
      expect(zoomOf(zoomAt(base, base, box, { x: 0, y: 0 }, 0.001), base)).toBeCloseTo(MIN_ZOOM)
    })
  })

  test('panBy moves the page with the pointer', () => {
    const moved = panBy(base, box, 20, -10)
    expect(moved.x).toBeCloseTo(base.x - 10)
    expect(moved.y).toBeCloseTo(base.y + 5)
    expect(moved.w).toBe(base.w)
  })

  test('pinchView zooms by finger distance and pans by midpoint', () => {
    const from: [ClientPoint, ClientPoint] = [
      { x: 100, y: 200 },
      { x: 200, y: 200 },
    ]
    const spread = pinchView(base, base, box, from, [
      { x: 50, y: 200 },
      { x: 250, y: 200 },
    ])
    expect(zoomOf(spread, base)).toBeCloseTo(2)
    const midBefore = clientToPage(base, box, { x: 150, y: 200 })
    const midAfter = clientToPage(spread, box, { x: 150, y: 200 })
    expect(midAfter?.x).toBeCloseTo(midBefore?.x ?? Number.NaN)

    const slid = pinchView(base, base, box, from, [
      { x: 120, y: 200 },
      { x: 220, y: 200 },
    ])
    expect(zoomOf(slid, base)).toBeCloseTo(1)
    expect(slid.x).toBeCloseTo(base.x - 10)
  })

  test('wheelFactor zooms in on scroll up and scales line deltas', () => {
    expect(wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeGreaterThan(1)
    expect(wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeLessThan(1)
    expect(wheelFactor({ deltaY: 1, deltaMode: 1, ctrlKey: false })).toBeCloseTo(
      wheelFactor({ deltaY: 16, deltaMode: 0, ctrlKey: false }),
    )
  })
}
