import type { Panel, Point, Rect } from './project'

const EPSILON = 1e-9

const UNIT_SQUARE: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

/**
 * コマの輪郭をページ座標の頂点列で返す。`shape` が無ければ `rect` の 4 隅を左上から時計回りに返す
 */
export function panelOutline(panel: Pick<Panel, 'rect' | 'shape'>): Point[] {
  const { x, y, w, h } = panel.rect
  return (panel.shape ?? UNIT_SQUARE).map((p) => ({ x: x + p.x * w, y: y + p.y * h }))
}

/**
 * コマを奥から手前へ並べた新しい配列。枠なしのコマは枠ありのコマより奥に置き、同じ側どうしは order の大きいものが手前。
 * 描画と当たり判定はこの順で重ねる
 */
export function paintOrder<T extends Pick<Panel, 'order' | 'frame'>>(panels: readonly T[]): T[] {
  const depth = (p: T) => (p.frame === 'none' ? 0 : 1)
  return [...panels].sort((a, b) => depth(a) - depth(b) || a.order - b.order)
}

/** 2 つのコマが重なってよいか。枠なしのコマの上に枠ありのコマを重ねる下敷きだけを許す */
export const mayOverlap = (a: Pick<Panel, 'frame'>, b: Pick<Panel, 'frame'>): boolean =>
  (a.frame === 'none') !== (b.frame === 'none')

/** 頂点列を囲む最小の矩形。頂点が無ければ大きさ 0 */
export function boundsOf(points: readonly Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

const signedArea = (poly: readonly Point[]) => {
  let sum = 0
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length] as Point
    sum += p.x * q.y - q.x * p.y
  })
  return sum / 2
}

/** 多角形の面積。向きは問わない */
export const polygonArea = (poly: readonly Point[]): number => Math.abs(signedArea(poly))

/** 点が多角形の内側か辺の上にあるか */
export function containsPoint(poly: readonly Point[], p: Point): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point
    const b = poly[j] as Point
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    const onSegment =
      Math.abs(cross) <= EPSILON * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) &&
      p.x >= Math.min(a.x, b.x) - EPSILON &&
      p.x <= Math.max(a.x, b.x) + EPSILON &&
      p.y >= Math.min(a.y, b.y) - EPSILON &&
      p.y <= Math.max(a.y, b.y) + EPSILON
    if (onSegment) return true
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** 直線 a→b からの符号付き距離。y 下向きの座標で、a→b の進行方向の右手が正 */
export function sideOf(a: Point, b: Point, p: Point): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  return len === 0 ? 0 : ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len
}

/**
 * 多角形のうち、直線 a→b からの符号付き距離（sideOf）が offset 以上の部分。残らなければ空
 */
export function clipHalfPlane(poly: readonly Point[], a: Point, b: Point, offset: number): Point[] {
  const out: Point[] = []
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length] as Point
    const dp = sideOf(a, b, p) - offset
    const dq = sideOf(a, b, q) - offset
    if (dp >= 0) out.push(p)
    if (dp >= 0 !== dq >= 0) {
      const t = dp / (dp - dq)
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
    }
  })
  return out.length >= 3 ? out : []
}

/** 凸包。頂点の向きは signedArea が正になる向き */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return sorted
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const half = (pts: Point[]) => {
    const h: Point[] = []
    for (const p of pts) {
      while (h.length >= 2 && cross(h[h.length - 2] as Point, h[h.length - 1] as Point, p) <= 0) {
        h.pop()
      }
      h.push(p)
    }
    h.pop()
    return h
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

/**
 * subject と clip の共通部分。clip は凸でなければならず、凹んでいれば凸包を渡す。重ならなければ空
 */
export function intersectPolygons(subject: readonly Point[], clip: readonly Point[]): Point[] {
  const sign = signedArea(clip) >= 0 ? 1 : -1
  let out: Point[] = [...subject]
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i] as Point
    const b = clip[(i + 1) % clip.length] as Point
    out = sign > 0 ? clipHalfPlane(out, a, b, 0) : clipHalfPlane(out, b, a, 0)
  }
  return out
}

/**
 * 輪郭の右上（corner が 'ne'）か右下（'se'）の頂点から (dx, dy) ずらした点。コマ番号やボタンを
 * コマの隅に置くのに使う。そこが輪郭の外なら、内側に入るまで頂点の重心へ寄せる。
 * 矩形のコマでは隅から (dx, dy) ずらした点そのもの。座標の単位は問わない
 */
export function cornerAnchor(
  outline: readonly Point[],
  corner: 'ne' | 'se',
  dx: number,
  dy: number,
): Point {
  const score = (p: Point) => (corner === 'ne' ? p.x - p.y : p.x + p.y)
  const v = outline.reduce((best, p) => (score(p) > score(best) ? p : best))
  const c = {
    x: outline.reduce((sum, p) => sum + p.x, 0) / outline.length,
    y: outline.reduce((sum, p) => sum + p.y, 0) / outline.length,
  }
  const start = { x: v.x + dx, y: v.y + dy }
  for (let t = 0; t < 1; t += 0.1) {
    const p = { x: start.x + (c.x - start.x) * t, y: start.y + (c.y - start.y) * t }
    if (containsPoint(outline, p)) return p
  }
  return c
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const tri: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ]

  test('panelOutline maps the shape into the rect, and the rect corners without one', () => {
    const rect = { x: 0.5, y: 0.2, w: 0.4, h: 0.2 }
    expect(panelOutline({ rect })).toEqual([
      { x: 0.5, y: 0.2 },
      { x: 0.9, y: 0.2 },
      { x: 0.9, y: 0.4 },
      { x: 0.5, y: 0.4 },
    ])
    expect(panelOutline({ rect, shape: tri })[2]).toEqual({ x: 0.5, y: 0.4 })
  })

  test('paintOrder puts borderless panels behind framed ones, then sorts by order', () => {
    const panels = [
      { id: 'a', order: 1 },
      { id: 'b', order: 2, frame: 'none' as const },
      { id: 'c', order: 0 },
      { id: 'd', order: 3, frame: 'none' as const },
    ]
    expect(paintOrder(panels).map((p) => p.id)).toEqual(['b', 'd', 'c', 'a'])
    expect(panels.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('mayOverlap allows only a framed panel over a borderless one', () => {
    expect(mayOverlap({ frame: 'none' }, {})).toBe(true)
    expect(mayOverlap({}, { frame: 'none' })).toBe(true)
    expect(mayOverlap({}, {})).toBe(false)
    expect(mayOverlap({ frame: 'none' }, { frame: 'none' })).toBe(false)
  })

  test('containsPoint counts the boundary as inside', () => {
    expect(containsPoint(tri, { x: 0.2, y: 0.2 })).toBe(true)
    expect(containsPoint(tri, { x: 0.6, y: 0.6 })).toBe(false)
    expect(containsPoint(tri, { x: 0.5, y: 0.5 })).toBe(true)
    expect(containsPoint(tri, { x: 0, y: 0.3 })).toBe(true)
  })

  test('clipHalfPlane keeps the side at least offset away from the line', () => {
    const square = panelOutline({ rect: { x: 0, y: 0, w: 1, h: 1 } })
    const right = clipHalfPlane(square, { x: 0.5, y: 1 }, { x: 0.5, y: 0 }, 0.1)
    expect(boundsOf(right)).toEqual({ x: 0.6, y: 0, w: 0.4, h: 1 })
    expect(clipHalfPlane(square, { x: 2, y: 1 }, { x: 2, y: 0 }, 0)).toEqual([])
  })

  test('intersectPolygons and polygonArea', () => {
    const a = panelOutline({ rect: { x: 0, y: 0, w: 0.6, h: 1 } })
    const b = panelOutline({ rect: { x: 0.4, y: 0, w: 0.6, h: 1 } })
    expect(polygonArea(intersectPolygons(a, b))).toBeCloseTo(0.2)
    // 辺が接しているだけなら面積 0
    const c = panelOutline({ rect: { x: 0.6, y: 0, w: 0.4, h: 1 } })
    expect(polygonArea(intersectPolygons(a, c))).toBeCloseTo(0)
    expect(polygonArea(intersectPolygons(tri, [...b].reverse()))).toBeCloseTo(0.18)
  })

  test('cornerAnchor insets from the corner, and moves inside when the corner is cut off', () => {
    const square = panelOutline({ rect: { x: 0, y: 0, w: 10, h: 10 } })
    expect(cornerAnchor(square, 'ne', -1, 1)).toEqual({ x: 9, y: 1 })
    expect(cornerAnchor(square, 'se', -1, -1)).toEqual({ x: 9, y: 9 })
    // 右上を斜めに落とした三角形
    const triangle = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(containsPoint(triangle, cornerAnchor(triangle, 'ne', -1, 1))).toBe(true)
  })

  test('convexHull drops inner points', () => {
    const hull = convexHull([...tri, { x: 0.1, y: 0.1 }, { x: 1, y: 1 }])
    expect(hull).toHaveLength(4)
    expect(polygonArea(hull)).toBeCloseTo(1)
  })
}
