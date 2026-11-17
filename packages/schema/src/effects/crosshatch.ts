import type { Panel, Point, Rect } from '../project'
import { radialCenter } from './radial-center'

/** 網を敷く升目の一辺と線の幅。1 ページの幅に対する比 */
const CROSSHATCH_CELL = 0.03
const CROSSHATCH_WIDTH = 0.0022
/** 1 つの升目に重ねる、平行な線の束の数の上限。束ごとに向きを変えるので、束が増えるほど網が詰まって濃くなる */
const CROSSHATCH_LAYERS = 3
/** 1 つの束の線の本数 */
const CROSSHATCH_STROKES = 3
/** 何も敷かない範囲。焦点からコマの縁までの道のりに対する比 */
const CROSSHATCH_CLEAR = 0.35
/** 束ごとに回す角度。60° ずつ回すと、2 束で斜めに交差し、3 束で三方向の目の詰まった網になる */
const CROSSHATCH_TURN = Math.PI / 3

/**
 * カケアミ（crosshatch）の効果線を、塗りつぶす多角形の列で返す。引数と返す座標の単位は effectLines と同じで、
 * random はコマの id を種にした擬似乱数。コマを升目に分け、升目ごとに短い平行線の束を向きを変えて重ねる。
 * 各線は両端が尖る細長い菱形 [始点, 中ほどの片側, 終点, 中ほどの反対側]。重ねる束の数は hatchDensity で決め、
 * 焦点（weight が最大のもの、無ければコマの中心）のまわりは空け、コマの縁へ行くほど増やす
 */
export function crosshatch(
  panel: Pick<Panel, 'id' | 'focusPoints' | 'vectors'>,
  box: Rect,
  unit: number,
  random: () => number,
): Point[][] {
  const { c } = radialCenter(panel, box)
  const size = unit * CROSSHATCH_CELL
  // 升目が 0 だと升目の数が無限になる
  if (!(size > 0)) return []
  const cols = Math.max(1, Math.round(box.w / size))
  const rows = Math.max(1, Math.round(box.h / size))
  const cellW = box.w / cols
  const cellH = box.h / rows
  const half = (unit * CROSSHATCH_WIDTH) / 2
  const lines: Point[][] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const p = {
        x: box.x + cellW * (col + 0.5 + (random() - 0.5) * 0.5),
        y: box.y + cellH * (row + 0.5 + (random() - 0.5) * 0.5),
      }
      const amount = hatchDensity(towardEdge(c, box, p)) * CROSSHATCH_LAYERS
      const layers = Math.floor(amount) + (random() < amount % 1 ? 1 : 0)
      const base = Math.PI / 4 + (random() - 0.5) * 0.4
      for (let layer = 0; layer < layers; layer++) {
        const angle = base + layer * CROSSHATCH_TURN
        const u = { x: Math.cos(angle), y: Math.sin(angle) }
        const n = { x: -u.y, y: u.x }
        for (let s = 0; s < CROSSHATCH_STROKES; s++) {
          const offset = ((s - (CROSSHATCH_STROKES - 1) / 2) * size) / CROSSHATCH_STROKES
          const length = size * (0.9 + 0.4 * random())
          const width = half * (0.6 + 0.8 * random())
          const m = { x: p.x + n.x * offset, y: p.y + n.y * offset }
          lines.push([
            { x: m.x - (u.x * length) / 2, y: m.y - (u.y * length) / 2 },
            { x: m.x + n.x * width, y: m.y + n.y * width },
            { x: m.x + (u.x * length) / 2, y: m.y + (u.y * length) / 2 },
            { x: m.x - n.x * width, y: m.y - n.y * width },
          ])
        }
      }
    }
  }
  return lines
}

/**
 * p が中心 c からコマの縁までのどこにあるか。c で 0、上下左右の縁で 1、角では 1 を超える。
 * 焦点が端に寄っても、焦点から近い縁と遠い縁の両方が 1 になるよう、縦横それぞれ p の側の縁までの距離で割る
 */
function towardEdge(c: Point, box: Rect, p: Point): number {
  const ex = p.x >= c.x ? box.x + box.w - c.x : c.x - box.x
  const ey = p.y >= c.y ? box.y + box.h - c.y : c.y - box.y
  const qx = ex > 0 ? Math.abs(p.x - c.x) / ex : 0
  const qy = ey > 0 ? Math.abs(p.y - c.y) / ey : 0
  return Math.hypot(qx, qy)
}

/** towardEdge の値に対する網の濃さ（0〜1）。CROSSHATCH_CLEAR までは 0、そこから縁まで線形に上がり、縁より外は 1 */
function hatchDensity(q: number): number {
  return Math.min(1, Math.max(0, (q - CROSSHATCH_CLEAR) / (1 - CROSSHATCH_CLEAR)))
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
  const panel = (focusPoints: Panel['focusPoints'] = []) => ({
    id: 'pn_crosshatch',
    focusPoints,
    vectors: [],
  })
  const midpoint = (line: Point[]) => {
    const [a, , b] = line as [Point, Point, Point]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  const direction = (line: Point[]) => {
    const [a, , b] = line as [Point, Point, Point]
    // 菱形の向きは 180° 回しても同じなので、0 以上 π 未満にそろえる
    return (Math.atan2(b.y - a.y, b.x - a.x) + Math.PI) % Math.PI
  }

  test('hatchDensity is empty around the centre and full from the edge outward', () => {
    expect(hatchDensity(0)).toBe(0)
    expect(hatchDensity(CROSSHATCH_CLEAR)).toBe(0)
    expect(hatchDensity((CROSSHATCH_CLEAR + 1) / 2)).toBeCloseTo(0.5)
    expect(hatchDensity(1)).toBe(1)
    expect(hatchDensity(1.4)).toBe(1)
  })

  test('towardEdge measures each side against its own edge', () => {
    const c = { x: box.x + 0.8 * box.w, y: box.y + 0.5 * box.h }
    expect(towardEdge(c, box, c)).toBe(0)
    expect(towardEdge(c, box, { x: box.x, y: c.y })).toBeCloseTo(1)
    expect(towardEdge(c, box, { x: box.x + box.w, y: c.y })).toBeCloseTo(1)
    expect(towardEdge(c, box, { x: c.x, y: box.y })).toBeCloseTo(1)
    // 焦点が角にあると、その側の縁までの距離が 0 になる
    const corner = { x: box.x + box.w, y: box.y + box.h }
    expect(towardEdge(corner, box, corner)).toBe(0)
  })

  test('crosshatch leaves the panel centre empty and is densest along the edges', () => {
    const lines = crosshatch(panel(), box, 100, sequence(1))
    const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    const near = lines.filter((l) => towardEdge(c, box, midpoint(l)) < 0.2)
    expect(lines.length).toBeGreaterThan(100)
    expect(near).toEqual([])
    // 縁沿いの升目は束を CROSSHATCH_LAYERS だけ重ねるので、三方向の線が揃う
    const edge = lines.filter((l) => towardEdge(c, box, midpoint(l)) > 1.1)
    const turns = new Set(edge.map((l) => Math.round(direction(l) / (CROSSHATCH_TURN / 2))))
    expect(turns.size).toBeGreaterThanOrEqual(CROSSHATCH_LAYERS)
  })

  test('crosshatch strokes cross each other at different angles', () => {
    const angles = crosshatch(panel(), box, 100, sequence(3)).map(direction)
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(CROSSHATCH_TURN)
  })

  test('crosshatch clears the space around the heaviest focus instead of the centre', () => {
    const focus = (id: string, x: number, y: number, weight: number) => ({
      id,
      kind: 'face' as const,
      label: id,
      pos: { x, y },
      weight,
    })
    const lines = crosshatch(
      panel([focus('light', 0.2, 0.3, 0.2), focus('heavy', 0.75, 0.6, 0.9)]),
      box,
      100,
      sequence(5),
    )
    const heavy = { x: box.x + 0.75 * box.w, y: box.y + 0.6 * box.h }
    const light = { x: box.x + 0.2 * box.w, y: box.y + 0.3 * box.h }
    const around = (c: Point) =>
      lines.filter((l) => Math.hypot(midpoint(l).x - c.x, midpoint(l).y - c.y) < 4)
    expect(around(heavy)).toEqual([])
    expect(around(light).length).toBeGreaterThan(0)
  })

  test('crosshatch stays near the box and repeats for the same random sequence', () => {
    const lines = crosshatch(panel(), box, 100, sequence(7))
    const margin = 100 * CROSSHATCH_CELL * 1.5
    for (const line of lines) {
      for (const p of line) {
        expect(p.x).toBeGreaterThan(box.x - margin)
        expect(p.x).toBeLessThan(box.x + box.w + margin)
        expect(p.y).toBeGreaterThan(box.y - margin)
        expect(p.y).toBeLessThan(box.y + box.h + margin)
      }
    }
    expect(crosshatch(panel(), box, 100, sequence(7))).toEqual(lines)
    expect(crosshatch(panel(), box, 100, sequence(8))).not.toEqual(lines)
  })

  test('crosshatch draws nothing for a zero unit', () => {
    expect(crosshatch(panel(), box, 0, sequence(1))).toEqual([])
  })
}
