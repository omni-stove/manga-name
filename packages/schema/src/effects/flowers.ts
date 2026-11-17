import type { Panel, Point, Rect } from '../project'
import { focusCenter, insideEllipse } from './focus'

const FLOWER_PETALS = 5
/** 花の半径の下限と上限。1 ページの幅に対する比 */
const FLOWER_SMALLEST = 0.02
const FLOWER_LARGEST = 0.05
/** 花の半径の上限の、コマの短辺に対する比。小さいコマを花で埋めない */
const FLOWER_MAX_SHARE = 0.2
/** 花 1 つあたりのコマの周の長さ。1 ページの幅に対する比 */
const FLOWER_SPACING = 0.1
const MIN_FLOWERS = 5
/** 花の中心を置く帯の深さ。コマの縁から内へ、コマの短辺に対する比 */
const FLOWER_BAND = 0.35
/** 花を置かない楕円の半径の、コマの幅と高さに対する比。花は背景なので焦点の人物や物に重ねない */
const FLOWER_CLEAR = 0.2
/** 花びらの間の切れ込みの底の、花の半径に対する比 */
const FLOWER_NOTCH = 0.45
/** 輪郭の線の太さの、花の半径に対する比 */
const FLOWER_LINE = 0.1
/** 花芯の半径の、花の半径に対する比。切れ込みの底の線の内側より小さくし、輪郭の線と離す */
const FLOWER_CORE = 0.16
const PETAL_SEGMENTS = 12
const FLOWER_SEGMENTS = FLOWER_PETALS * PETAL_SEGMENTS
const CORE_SEGMENTS = 12
/**
 * 隣の花との間の下限。2 つの花の半径の和に対する比。地を白く塗らずに輪郭だけ描くので、
 * 重なると後ろの花の線が透けて見える
 */
const FLOWER_GAP = 0.95
/** 1 つの花を置くまでに試す位置の数の上限。焦点の楕円や他の花に当たる位置は捨てて引き直す */
const ATTEMPTS_PER_FLOWER = 30

/**
 * 花（flowers）の効果を、塗りつぶす多角形の列で返す。引数と返す座標の単位は effectLines と同じで、
 * random はコマの id を種にした擬似乱数。
 *
 * 1 つの花は 2 つの多角形で、5 弁の花の輪郭の線（外の縁を回り、切れ目で内の縁へ渡って逆に回る 1 つの多角形。
 * 非ゼロ規則で塗ると内側が抜ける）と、丸い花芯。花の中心はコマの box の周の上の一様な位置から内へ、
 * 短辺の FLOWER_BAND までの深さに置き、深さを 2 乗でとって縁ほど多くする。縁の花はコマの輪郭で切れる。
 * 焦点（weight が最大のもの、無ければコマの中心）のまわりの FLOWER_CLEAR の楕円には輪郭のどの頂点も入れず、
 * 花どうしも重ねない
 */
export function flowers(
  panel: Pick<Panel, 'id' | 'focusPoints' | 'vectors'>,
  box: Rect,
  unit: number,
  random: () => number,
): Point[][] {
  const c = focusCenter(panel, box)
  const rx = box.w * FLOWER_CLEAR
  const ry = box.h * FLOWER_CLEAR
  const perimeter = 2 * (box.w + box.h)
  const count = Math.max(MIN_FLOWERS, Math.round(perimeter / (unit * FLOWER_SPACING)))
  const short = Math.min(box.w, box.h)
  const largest = Math.min(unit * FLOWER_LARGEST, short * FLOWER_MAX_SHARE)
  const smallest = Math.min(unit * FLOWER_SMALLEST, largest)
  const band = short * FLOWER_BAND
  const placed: { at: Point; radius: number }[] = []
  const shapes: Point[][] = []
  for (let i = 0; i < count * ATTEMPTS_PER_FLOWER && placed.length < count; i++) {
    const { p, inward } = edgePoint(box, perimeter * random())
    const depth = band * random() ** 2
    const radius = smallest + (largest - smallest) * random()
    const turn = (2 * Math.PI * random()) / FLOWER_PETALS
    const at = { x: p.x + inward.x * depth, y: p.y + inward.y * depth }
    const crowded = placed.some(
      (f) => Math.hypot(f.at.x - at.x, f.at.y - at.y) < (f.radius + radius) * FLOWER_GAP,
    )
    if (crowded) continue
    const outer = petalContour(at, radius, turn, 0)
    if (outer.some((q) => insideEllipse(q, c, rx, ry))) continue
    const inner = petalContour(at, radius, turn, radius * FLOWER_LINE)
    placed.push({ at, radius })
    shapes.push([...outer, ...inner.reverse()], circle(at, radius * FLOWER_CORE))
  }
  return shapes
}

/**
 * box の左上の角から時計回りに周を length だけ進んだ点と、そこでの box の内向きの単位ベクトル。
 * コマの輪郭が斜めでも box の周に沿って置き、外に出た花は呼び出し側が輪郭で切る
 */
function edgePoint(box: Rect, length: number): { p: Point; inward: Point } {
  let t = length
  if (t < box.w) return { p: { x: box.x + t, y: box.y }, inward: { x: 0, y: 1 } }
  t -= box.w
  if (t < box.h) return { p: { x: box.x + box.w, y: box.y + t }, inward: { x: -1, y: 0 } }
  t -= box.h
  if (t < box.w) return { p: { x: box.x + box.w - t, y: box.y + box.h }, inward: { x: 0, y: -1 } }
  t -= box.w
  return { p: { x: box.x, y: box.y + box.h - Math.min(t, box.h) }, inward: { x: 1, y: 0 } }
}

/**
 * at を中心に、半径 radius の 5 弁の花の輪郭から inset だけ内へ寄せた閉じた頂点列。最初と最後の頂点は同じ位置で、
 * turn の向きに 1 枚目の花びらの先が来る。中心からの距離を |cos(5θ/2)| の平方根でとるので、
 * 花びらの先は丸く、間の切れ込みは尖る
 */
function petalContour(at: Point, radius: number, turn: number, inset: number): Point[] {
  return Array.from({ length: FLOWER_SEGMENTS + 1 }, (_, k) => {
    const theta = (2 * Math.PI * k) / FLOWER_SEGMENTS
    const petal = Math.sqrt(Math.abs(Math.cos((FLOWER_PETALS * theta) / 2)))
    const r = radius * (FLOWER_NOTCH + (1 - FLOWER_NOTCH) * petal) - inset
    return { x: at.x + r * Math.cos(theta + turn), y: at.y + r * Math.sin(theta + turn) }
  })
}

function circle(at: Point, radius: number): Point[] {
  return Array.from({ length: CORE_SEGMENTS }, (_, k) => {
    const theta = (2 * Math.PI * k) / CORE_SEGMENTS
    return { x: at.x + radius * Math.cos(theta), y: at.y + radius * Math.sin(theta) }
  })
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { effectLines } = await import('../appearance')
  const box: Rect = { x: 10, y: 20, w: 200, h: 100 }
  const panel = (
    focusPoints: Panel['focusPoints'] = [],
  ): Pick<Panel, 'id' | 'effect' | 'focusPoints' | 'vectors'> => ({
    id: 'pn_flowers',
    effect: 'flowers',
    focusPoints,
    vectors: [],
  })
  /** 花ごとに、輪郭の線と花芯の組にする */
  const blooms = (shapes: Point[][]) =>
    Array.from({ length: shapes.length / 2 }, (_, i) => {
      const line = shapes[2 * i] as Point[]
      const core = shapes[2 * i + 1] as Point[]
      const at = {
        x: core.reduce((s, p) => s + p.x, 0) / core.length,
        y: core.reduce((s, p) => s + p.y, 0) / core.length,
      }
      return { line, core, at }
    })
  const edgeDistance = (p: Point) =>
    Math.min(p.x - box.x, box.x + box.w - p.x, p.y - box.y, box.y + box.h - p.y)

  test('flowers draw five-petal outlines with a hole and a round core', () => {
    const shapes = effectLines(panel(), box, 100)
    expect(shapes.length % 2).toBe(0)
    const all = blooms(shapes)
    expect(all.length).toBeGreaterThanOrEqual(MIN_FLOWERS)
    for (const { line, core, at } of all) {
      expect(line).toHaveLength(2 * (FLOWER_SEGMENTS + 1))
      const dist = (p: Point) => Math.hypot(p.x - at.x, p.y - at.y)
      const outer = line.slice(0, FLOWER_SEGMENTS).map(dist)
      const inner = line.slice(FLOWER_SEGMENTS + 1).map(dist)
      const petals = outer.filter((v, k) => {
        const prev = outer[(k + outer.length - 1) % outer.length] as number
        const next = outer[(k + 1) % outer.length] as number
        return v > prev && v > next
      })
      expect(petals).toHaveLength(FLOWER_PETALS)
      // 内の縁は外の縁を逆に回り、線の太さだけ内にある
      expect(inner).toHaveLength(FLOWER_SEGMENTS + 1)
      for (let k = 0; k <= FLOWER_SEGMENTS; k++) {
        const o = dist(line[k] as Point)
        const n = dist(line[2 * FLOWER_SEGMENTS + 1 - k] as Point)
        expect(o - n).toBeCloseTo(Math.max(...outer) * FLOWER_LINE, 6)
      }
      // 花芯は輪郭の線に触れない
      expect(Math.max(...core.map(dist))).toBeLessThan(Math.min(...inner))
    }
  })

  test('flowers crowd the edges of the panel', () => {
    // ページの幅を小さくとって花を小さく多くし、花どうしが場所を取り合って内へ押し出される分を減らす
    const all = blooms(effectLines(panel(), box, 50))
    const band = Math.min(box.w, box.h) * FLOWER_BAND
    for (const { at } of all) {
      expect(edgeDistance(at)).toBeGreaterThanOrEqual(-1e-9)
      expect(edgeDistance(at)).toBeLessThanOrEqual(band + 1e-9)
    }
    const nearEdge = all.filter(({ at }) => edgeDistance(at) < band / 2).length
    expect(nearEdge).toBeGreaterThan(all.length - nearEdge)
  })

  test('flowers keep off the ellipse around the heaviest focus, or the centre without one', () => {
    const focus = (id: string, x: number, y: number, weight: number) => ({
      id,
      kind: 'face' as const,
      label: id,
      pos: { x, y },
      weight,
    })
    const cases = [
      {
        focusPoints: [focus('light', 0.8, 0.8, 0.2), focus('heavy', 0.15, 0.2, 0.9)],
        c: { x: box.x + 0.15 * box.w, y: box.y + 0.2 * box.h },
      },
      { focusPoints: [], c: { x: box.x + box.w / 2, y: box.y + box.h / 2 } },
    ]
    for (const { focusPoints, c } of cases) {
      const all = blooms(effectLines(panel(focusPoints), box, 100))
      expect(all.length).toBeGreaterThan(0)
      for (const { line } of all) {
        for (const p of line) {
          expect(insideEllipse(p, c, box.w * FLOWER_CLEAR, box.h * FLOWER_CLEAR)).toBe(false)
        }
      }
    }
  })

  test('flowers do not overlap each other', () => {
    const all = blooms(effectLines(panel(), box, 100))
    const radii = all.map(({ line, at }) =>
      Math.max(...line.map((p) => Math.hypot(p.x - at.x, p.y - at.y))),
    )
    all.forEach((a, i) => {
      all.slice(i + 1).forEach((b, j) => {
        const gap = Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y)
        expect(gap).toBeGreaterThanOrEqual(
          ((radii[i] as number) + (radii[i + 1 + j] as number)) * FLOWER_GAP - 1e-9,
        )
      })
    })
  })
}
