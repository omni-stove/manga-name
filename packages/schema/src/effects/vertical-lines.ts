import type { Panel, Point, Rect } from '../project'

/** 線の間隔と根元の幅。1 ページの幅に対する比 */
const VERTICAL_SPACING = 0.006
const VERTICAL_WIDTH = 0.003
/** 線の長さの下限。コマの高さに対する比で、上の縁沿いは途切れず黒く見えるようにする */
const VERTICAL_SHORTEST = 0.15
/** 根元をコマの上の縁より上から始める量。1 ページの幅に対する比で、呼び出し側が輪郭で切ったとき上端が平らに揃う */
const VERTICAL_OVERSHOOT = 0.01

/**
 * 縦線（vertical_lines）の効果線を、塗りつぶす多角形の列で返す。引数と返す座標の単位は effectLines と同じで、
 * random はコマの id を種にした擬似乱数。各線はコマの上の縁から真下へ垂れ、根元が太く先が尖る三角形
 * [根元の左, 根元の右, 先端] で、コマの幅いっぱいに並ぶ。長さはコマの高さの VERTICAL_SHORTEST 倍から
 * 1 倍までばらけるので、上の方は線が詰まって濃く、下へ行くほど届く線が減って疎らになる。焦点とベクトルは見ない
 */
export function verticalLines(
  _panel: Pick<Panel, 'id' | 'focusPoints' | 'vectors'>,
  box: Rect,
  unit: number,
  random: () => number,
): Point[][] {
  const spacing = unit * VERTICAL_SPACING
  // 間隔が 0 だと線を並べ終わらない
  if (!(spacing > 0)) return []
  const top = box.y - unit * VERTICAL_OVERSHOOT
  const lines: Point[][] = []
  for (let x = box.x + spacing * random(); x < box.x + box.w; ) {
    const length = box.h * (VERTICAL_SHORTEST + (1 - VERTICAL_SHORTEST) * random())
    const half = (unit * VERTICAL_WIDTH * (0.4 + random())) / 2
    lines.push([
      { x: x - half, y: top },
      { x: x + half, y: top },
      { x, y: box.y + length },
    ])
    x += spacing * (0.5 + random())
  }
  return lines
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  // effectLines の種から作る乱数は appearance を import しないと使えず、appearance はこのファイルを import するので、
  // ここでは決まった列を返す線形合同法で代える。同じ id から同じ線が出ることは appearance のテストが見る
  const sequence = (seed: number) => () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const box: Rect = { x: 10, y: 20, w: 100, h: 50 }
  const panel = { id: 'pn_vertical', focusPoints: [], vectors: [] }
  const lines = verticalLines(panel, box, 100, sequence(1)) as [Point, Point, Point][]

  test('vertical lines hang straight down from above the top edge and taper to a tip inside the box', () => {
    expect(lines.length).toBeGreaterThan(50)
    for (const [a, b, tip] of lines) {
      expect(a.y).toBe(b.y)
      expect(a.y).toBeLessThan(box.y)
      expect((a.x + b.x) / 2).toBeCloseTo(tip.x, 9)
      expect(b.x - a.x).toBeGreaterThan(0)
      expect(b.x - a.x).toBeLessThan(VERTICAL_WIDTH * 100 * 1.4 + 1e-9)
      expect(tip.y).toBeGreaterThanOrEqual(box.y + box.h * VERTICAL_SHORTEST - 1e-9)
      expect(tip.y).toBeLessThanOrEqual(box.y + box.h + 1e-9)
    }
  })

  test('vertical lines spread across the whole width', () => {
    const xs = lines.map(([, , tip]) => tip.x)
    expect(Math.min(...xs)).toBeLessThan(box.x + box.w * 0.05)
    expect(Math.max(...xs)).toBeGreaterThan(box.x + box.w * 0.95)
    expect(xs.every((x) => x >= box.x && x < box.x + box.w)).toBe(true)
  })

  test('vertical lines thin out toward the bottom', () => {
    const reaching = (depth: number) =>
      lines.filter(([, , tip]) => tip.y >= box.y + box.h * depth).length
    expect(reaching(0.1)).toBe(lines.length)
    expect(reaching(0.5)).toBeLessThan(reaching(0.25))
    expect(reaching(0.9)).toBeLessThan(reaching(0.5))
    expect(reaching(0.9)).toBeLessThan(lines.length / 4)
  })

  test('vertical lines repeat for the same random sequence and change with another', () => {
    expect(verticalLines(panel, box, 100, sequence(1))).toEqual(lines)
    expect(verticalLines(panel, box, 100, sequence(2))).not.toEqual(lines)
  })

  test('vertical lines draw nothing for a zero unit', () => {
    expect(verticalLines(panel, box, 0, sequence(1))).toEqual([])
  })
}
