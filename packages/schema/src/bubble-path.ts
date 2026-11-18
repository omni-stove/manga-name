import type { Point } from './project'

/** 単位を問わない座標のフキダシ。rx, ry は本体の楕円の半径、tails はしっぽごとの先端 */
export interface BubbleGeometry {
  cx: number
  cy: number
  rx: number
  ry: number
  tails?: readonly Point[]
}

/** 輪郭の描画命令。SVG の path 命令と Canvas の moveTo などに 1 対 1 で写せる */
export type PathCommand =
  | { op: 'M' | 'L'; x: number; y: number }
  | { op: 'Q'; x1: number; y1: number; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' }

const ARC_SAMPLES = 256

/** 0 以上 1 未満の、i ごとに決まった揺らぎ。同じフキダシは毎回同じ形に描く */
export function jitter(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return s - Math.floor(s)
}

/** 輪郭の凹凸の大きさの基準。どの向きでも同じ大きさに見えるよう短い方の半径にする */
export const unitOf = (g: BubbleGeometry) => Math.min(g.rx, g.ry)

export interface Station {
  p: Point
  /** 外向きの単位法線 */
  n: Point
}

export function ellipseAt(g: BubbleGeometry, t: number): Station {
  const nx = Math.cos(t) / (g.rx || 1)
  const ny = Math.sin(t) / (g.ry || 1)
  const len = Math.hypot(nx, ny)
  return {
    p: { x: g.cx + g.rx * Math.cos(t), y: g.cy + g.ry * Math.sin(t) },
    n: { x: nx / len, y: ny / len },
  }
}

/** 楕円の周を count 等分した点。角度 0 から時計回り（y 下向き） */
export function stations(g: BubbleGeometry, count: number): Station[] {
  const lengths = [0]
  let prev = ellipseAt(g, 0).p
  for (let i = 1; i <= ARC_SAMPLES; i++) {
    const p = ellipseAt(g, (i / ARC_SAMPLES) * Math.PI * 2).p
    lengths.push((lengths[i - 1] as number) + Math.hypot(p.x - prev.x, p.y - prev.y))
    prev = p
  }
  const total = lengths[ARC_SAMPLES] as number
  let j = 0
  return Array.from({ length: count }, (_, i) => {
    const target = (total * i) / count
    while (j < ARC_SAMPLES - 1 && (lengths[j + 1] as number) < target) j++
    const a = lengths[j] as number
    const b = lengths[j + 1] as number
    const f = b > a ? (target - a) / (b - a) : 0
    return ellipseAt(g, ((j + f) / ARC_SAMPLES) * Math.PI * 2)
  })
}

/** 周を unit * spacing ごとに区切った数。min..max に収める */
export function countAlong(g: BubbleGeometry, spacing: number, min: number, max: number): number {
  const unit = unitOf(g)
  if (!(unit > 0)) return min
  const a = Math.max(g.rx, g.ry)
  const b = unit
  // Ramanujan の近似
  const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
  return Math.min(max, Math.max(min, Math.round(perimeter / (unit * spacing))))
}

/** s から外向きの法線に沿って d だけ進んだ点。d が負なら内へ入る */
export const along = (s: Station, d: number): Point => ({
  x: s.p.x + s.n.x * d,
  y: s.p.y + s.n.y * d,
})

export function polygon(points: readonly Point[]): PathCommand[] {
  return [
    ...points.map((p, i) => ({ op: i === 0 ? ('M' as const) : ('L' as const), x: p.x, y: p.y })),
    { op: 'Z' },
  ]
}

/** 命令列の終点（制御点は除く） */
export const pathPoints = (cmds: readonly PathCommand[]): Point[] =>
  cmds.flatMap((c) => (c.op === 'Z' ? [] : [{ x: c.x, y: c.y }]))
