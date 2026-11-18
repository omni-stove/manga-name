import type { Panel, Point, Rect } from '../project'
import { focusCenter, insideEllipse } from './focus'

/** 光を置かない楕円の半径の、コマの幅と高さに対する比。焦点の人物や物に光を重ねない */
const SPARKLE_CLEAR = 0.2
/** 光の中心を置く範囲。焦点のまわりの楕円の、SPARKLE_CLEAR の楕円に対する倍率 */
const SPARKLE_REACH = 3.5
/** 1 ページの幅を 1 辺とする正方形あたりの光の数 */
const SPARKLE_DENSITY = 60
const MIN_SPARKLES = 6
/** 光の縦の半径の下限と上限。1 ページの幅に対する比 */
const SPARKLE_SMALLEST = 0.006
const SPARKLE_LARGEST = 0.045
/** 光の縦の半径の上限の、コマの短辺に対する比。小さいコマを光で埋めない */
const SPARKLE_MAX_SHARE = 0.15
/** 横の筋の長さの、縦の筋に対する比。縦に長い光にする */
const SPARKLE_ASPECT = 0.75
/** 筋の細さ。大きいほど 4 本の筋の間がえぐれて細く尖る */
const SPARKLE_SHARPNESS = 4
/** 1 つの光の頂点の数。4 の倍数にして、4 つの先端が頂点に乗るようにする */
const SPARKLE_SEGMENTS = 32
/** 隣の光との間の下限。2 つの光の縦の半径の和に対する比で、細い筋の先どうしが少し寄るのは許す */
const SPARKLE_GAP = 0.8
/** 1 つの光を置くまでに試す位置の数の上限。焦点の楕円やコマの外、他の光に当たる位置は捨てて引き直す */
const ATTEMPTS_PER_SPARKLE = 30

/**
 * キラキラ（sparkle）の効果を、塗りつぶす多角形の列で返す。引数と返す座標の単位は effectLines と同じで、
 * random はコマの id を種にした擬似乱数。
 *
 * 1 つの光は、縦に長い 4 本の筋が中心で交わる四芒星（筋の間が内へえぐれた 1 つの多角形）。
 * 大きさは小さいものを多く、大きいものを少なく散らす。光の中心は焦点（weight が最大のもの、無ければコマの中心）の
 * まわりの楕円の内側で、焦点の近くほど多く、コマの box の中に置く。焦点のまわりの SPARKLE_CLEAR の楕円には
 * どの頂点も入れず、光どうしもほとんど重ねない
 */
export function sparkle(
  panel: Pick<Panel, 'id' | 'focusPoints' | 'vectors'>,
  box: Rect,
  unit: number,
  random: () => number,
): Point[][] {
  const c = focusCenter(panel, box)
  const rx = box.w * SPARKLE_CLEAR
  const ry = box.h * SPARKLE_CLEAR
  const count = Math.max(
    MIN_SPARKLES,
    Math.round(((box.w * box.h) / (unit * unit)) * SPARKLE_DENSITY),
  )
  const largest = Math.min(unit * SPARKLE_LARGEST, Math.min(box.w, box.h) * SPARKLE_MAX_SHARE)
  const smallest = Math.min(unit * SPARKLE_SMALLEST, largest)
  const placed: { at: Point; radius: number }[] = []
  const shapes: Point[][] = []
  for (let i = 0; i < count * ATTEMPTS_PER_SPARKLE && shapes.length < count; i++) {
    const angle = 2 * Math.PI * random()
    // 2 乗で焦点に近い側へ寄せる
    const spread = 1 + (SPARKLE_REACH - 1) * random() ** 2
    // 3 乗で小さい光を多くする
    const radius = smallest + (largest - smallest) * random() ** 3
    const at = { x: c.x + Math.cos(angle) * rx * spread, y: c.y + Math.sin(angle) * ry * spread }
    if (at.x < box.x || at.x > box.x + box.w || at.y < box.y || at.y > box.y + box.h) continue
    const crowded = placed.some(
      (p) => Math.hypot(p.at.x - at.x, p.at.y - at.y) < (p.radius + radius) * SPARKLE_GAP,
    )
    if (crowded) continue
    const shape = star(at, radius)
    if (shape.some((p) => insideEllipse(p, c, rx, ry))) continue
    placed.push({ at, radius })
    shapes.push(shape)
  }
  return shapes
}

/**
 * at を中心に、縦の半径 radius の四芒星。各象限で |cos|^p・|sin|^p をとる曲線なので、
 * 中心から見た頂点の角度が単調に回り、自己交差しない
 */
function star(at: Point, radius: number): Point[] {
  return Array.from({ length: SPARKLE_SEGMENTS }, (_, k) => {
    const t = (2 * Math.PI * k) / SPARKLE_SEGMENTS
    const cos = Math.cos(t)
    const sin = Math.sin(t)
    return {
      x: at.x + radius * SPARKLE_ASPECT * Math.sign(cos) * Math.abs(cos) ** SPARKLE_SHARPNESS,
      y: at.y + radius * Math.sign(sin) * Math.abs(sin) ** SPARKLE_SHARPNESS,
    }
  })
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { effectLines } = await import('../appearance')
  const box: Rect = { x: 10, y: 20, w: 100, h: 50 }
  const panel = (
    focusPoints: Panel['focusPoints'] = [],
  ): Pick<Panel, 'id' | 'effect' | 'focusPoints' | 'vectors'> => ({
    id: 'pn_sparkle',
    effect: 'sparkle',
    focusPoints,
    vectors: [],
  })
  const focus = (id: string, x: number, y: number, weight: number) => ({
    id,
    kind: 'face' as const,
    label: id,
    pos: { x, y },
    weight,
  })
  const centreOf = (shape: Point[]): Point => ({
    x: shape.reduce((s, p) => s + p.x, 0) / shape.length,
    y: shape.reduce((s, p) => s + p.y, 0) / shape.length,
  })
  const radiusOf = (shape: Point[]): number => {
    const at = centreOf(shape)
    return Math.max(...shape.map((p) => Math.hypot(p.x - at.x, p.y - at.y)))
  }

  test('sparkle scatters four-pointed stars of mixed sizes inside the box', () => {
    const shapes = effectLines(panel(), box, 100)
    expect(shapes.length).toBeGreaterThanOrEqual(MIN_SPARKLES)
    for (const shape of shapes) {
      expect(shape).toHaveLength(SPARKLE_SEGMENTS)
      const at = centreOf(shape)
      expect(at.x).toBeGreaterThanOrEqual(box.x)
      expect(at.x).toBeLessThanOrEqual(box.x + box.w)
      expect(at.y).toBeGreaterThanOrEqual(box.y)
      expect(at.y).toBeLessThanOrEqual(box.y + box.h)
      // 中心からの距離が極大になる頂点が 4 つの先端
      const r = shape.map((p) => Math.hypot(p.x - at.x, p.y - at.y))
      const tips = r.filter((v, k) => {
        const prev = r[(k + r.length - 1) % r.length] as number
        const next = r[(k + 1) % r.length] as number
        return v > prev && v > next
      })
      expect(tips).toHaveLength(4)
    }
    const radii = shapes.map(radiusOf)
    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii) * 2)
  })

  test('sparkle keeps every star off the ellipse around the heaviest focus and gathers around it', () => {
    const c = { x: box.x + 0.2 * box.w, y: box.y + 0.5 * box.h }
    const shapes = effectLines(
      panel([focus('light', 0.8, 0.2, 0.3), focus('heavy', 0.2, 0.5, 0.9)]),
      box,
      100,
    )
    expect(shapes.length).toBeGreaterThanOrEqual(MIN_SPARKLES)
    const rx = box.w * SPARKLE_CLEAR
    const ry = box.h * SPARKLE_CLEAR
    for (const shape of shapes) {
      for (const p of shape) expect(insideEllipse(p, c, rx, ry)).toBe(false)
      const at = centreOf(shape)
      expect(insideEllipse(at, c, rx * SPARKLE_REACH + 1e-9, ry * SPARKLE_REACH + 1e-9)).toBe(true)
    }
    // 焦点が左に寄っているので、光も box の中央より左に寄る
    const meanX = shapes.reduce((s, shape) => s + centreOf(shape).x, 0) / shapes.length
    expect(meanX).toBeLessThan(box.x + box.w / 2)
  })

  test('sparkle keeps off the centre of the panel when it has no focus', () => {
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    const shapes = effectLines(panel(), box, 100)
    for (const shape of shapes) {
      for (const p of shape) {
        expect(insideEllipse(p, c, box.w * SPARKLE_CLEAR, box.h * SPARKLE_CLEAR)).toBe(false)
      }
    }
  })

  test('sparkle shrinks the stars to fit a small panel', () => {
    const small: Rect = { x: 0, y: 0, w: 10, h: 8 }
    const shapes = effectLines(panel(), small, 100)
    expect(shapes.length).toBeGreaterThan(0)
    for (const shape of shapes) {
      expect(radiusOf(shape)).toBeLessThanOrEqual(small.h * SPARKLE_MAX_SHARE + 1e-9)
    }
  })
}
