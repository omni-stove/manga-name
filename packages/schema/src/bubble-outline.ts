import type { Bubble, Point } from './project'

type Shape = Bubble['shape']

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

/** フキダシの描き方。どの命令列も閉じたサブパスだけからなる */
export interface BubbleOutline {
  /** 本体 */
  body: PathCommand[]
  /** しっぽごとの命令列。並びは BubbleGeometry.tails と同じ。付かない形やしっぽが無いときは空 */
  tails: PathCommand[][]
  /** 黒で塗る形（ウニフラの放射線）。無ければ空 */
  ink: PathCommand[]
  /** 本体としっぽを白で塗るか。枠なしは塗らない */
  fill: boolean
  /** 本体としっぽの輪郭の線 */
  line: 'solid' | 'dashed' | 'none'
}

/** dashed の線と間の長さ。線幅に対する比率 */
export const BUBBLE_DASH = [3, 2] as const

// 輪郭の凹凸の大きさは、どの向きでも同じ大きさに見えるよう min(rx, ry) に対する比率で持つ。
// 楕円の角度で割り付けると、縦長や横長のフキダシで長い辺の凹凸だけが引き伸ばされる
const SHOUT_SPACING = 0.55
const SHOUT_DEPTH = 0.2
const SHOUT_JITTER = 0.1
const ELECTRONIC_SPACING = 0.3
const ELECTRONIC_DEPTH = 0.1
const THOUGHT_SPACING = 0.7
const THOUGHT_BULGE = 0.35
const TREMBLE_SPACING = 0.18
const TREMBLE_AMPLITUDE = 0.035
const TREMBLE_STEPS = 6
const URCHIN_SPACING = 0.1
const URCHIN_GAP = 0.04
const URCHIN_LENGTH = 0.35
const URCHIN_WIDTH = 0.03
/** しっぽの付け根の開き（ラジアン）と、付け根を輪郭から中心へ入れる深さ。深さは最も深い凹みより深くする */
const TAIL_SPREAD = 0.35
const TAIL_INSET = 0.5
const KAPPA = 0.5522847498
const ARC_SAMPLES = 256

const SHAPE_STYLE: Record<Shape, { tail: boolean; box: boolean }> = {
  normal: { tail: true, box: false },
  shout: { tail: true, box: false },
  thought: { tail: true, box: false },
  whisper: { tail: true, box: false },
  tremble: { tail: true, box: false },
  electronic: { tail: true, box: false },
  urchin: { tail: false, box: false },
  narration: { tail: false, box: true },
  none: { tail: false, box: true },
}

/** その形にしっぽが付くか。ナレーション、枠なし、ウニフラは話し手を指さない */
export const hasTail = (shape: Shape): boolean => SHAPE_STYLE[shape].tail

/** 本体が楕円でなく、半径で囲む矩形そのものか */
export const isBoxShape = (shape: Shape): boolean => SHAPE_STYLE[shape].box

/** 0 以上 1 未満の、i ごとに決まった揺らぎ。同じフキダシは毎回同じ形に描く */
function jitter(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return s - Math.floor(s)
}

const unitOf = (g: BubbleGeometry) => Math.min(g.rx, g.ry)

interface Station {
  p: Point
  /** 外向きの単位法線 */
  n: Point
}

function ellipseAt(g: BubbleGeometry, t: number): Station {
  const nx = Math.cos(t) / (g.rx || 1)
  const ny = Math.sin(t) / (g.ry || 1)
  const len = Math.hypot(nx, ny)
  return {
    p: { x: g.cx + g.rx * Math.cos(t), y: g.cy + g.ry * Math.sin(t) },
    n: { x: nx / len, y: ny / len },
  }
}

/** 楕円の周を count 等分した点。角度 0 から時計回り（y 下向き） */
function stations(g: BubbleGeometry, count: number): Station[] {
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
function countAlong(g: BubbleGeometry, spacing: number, min: number, max: number): number {
  const unit = unitOf(g)
  if (!(unit > 0)) return min
  const a = Math.max(g.rx, g.ry)
  const b = unit
  // Ramanujan の近似
  const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
  return Math.min(max, Math.max(min, Math.round(perimeter / (unit * spacing))))
}

const along = (s: Station, d: number): Point => ({ x: s.p.x + s.n.x * d, y: s.p.y + s.n.y * d })

function polygon(points: readonly Point[]): PathCommand[] {
  return [
    ...points.map((p, i) => ({ op: i === 0 ? ('M' as const) : ('L' as const), x: p.x, y: p.y })),
    { op: 'Z' },
  ]
}

function ellipse(cx: number, cy: number, rx: number, ry: number): PathCommand[] {
  const kx = rx * KAPPA
  const ky = ry * KAPPA
  return [
    { op: 'M', x: cx + rx, y: cy },
    { op: 'C', x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
    { op: 'C', x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
    { op: 'C', x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
    { op: 'C', x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
    { op: 'Z' },
  ]
}

function body(shape: Shape, g: BubbleGeometry): PathCommand[] {
  const unit = unitOf(g)
  switch (shape) {
    case 'normal':
    case 'whisper':
    case 'urchin':
      return ellipse(g.cx, g.cy, g.rx, g.ry)
    case 'narration':
    case 'none':
      return polygon([
        { x: g.cx - g.rx, y: g.cy - g.ry },
        { x: g.cx + g.rx, y: g.cy - g.ry },
        { x: g.cx + g.rx, y: g.cy + g.ry },
        { x: g.cx - g.rx, y: g.cy + g.ry },
      ])
    case 'shout': {
      // 先と谷の深さを揺らし、均一な星形（値札のような形）に見えないようにする
      const s = stations(g, countAlong(g, SHOUT_SPACING, 10, 40) * 2)
      return polygon(
        s.map((st, i) =>
          i % 2 === 0
            ? along(st, -unit * SHOUT_JITTER * jitter(i))
            : along(st, -unit * (SHOUT_DEPTH + SHOUT_JITTER * jitter(i))),
        ),
      )
    }
    case 'electronic': {
      const s = stations(g, countAlong(g, ELECTRONIC_SPACING, 16, 80) * 2)
      return polygon(s.map((st, i) => along(st, i % 2 === 0 ? 0 : -unit * ELECTRONIC_DEPTH)))
    }
    case 'thought': {
      const n = countAlong(g, THOUGHT_SPACING, 8, 24)
      const s = stations(g, n * 2)
      const start = s[0] as Station
      const cmds: PathCommand[] = [{ op: 'M', x: start.p.x, y: start.p.y }]
      for (let i = 0; i < n; i++) {
        const c = along(s[i * 2 + 1] as Station, unit * THOUGHT_BULGE)
        const e = (s[(i * 2 + 2) % s.length] as Station).p
        cmds.push({ op: 'Q', x1: c.x, y1: c.y, x: e.x, y: e.y })
      }
      cmds.push({ op: 'Z' })
      return cmds
    }
    case 'tremble': {
      const s = stations(g, countAlong(g, TREMBLE_SPACING, 24, 120) * TREMBLE_STEPS)
      return polygon(
        s.map((st, i) =>
          along(st, unit * TREMBLE_AMPLITUDE * Math.sin((i / TREMBLE_STEPS) * Math.PI * 2)),
        ),
      )
    }
  }
}

/** ウニフラの放射線。輪郭の少し外から外へ細くなる楔 */
function urchinRays(g: BubbleGeometry): PathCommand[] {
  const unit = unitOf(g)
  const w = unit * URCHIN_WIDTH
  return stations(g, countAlong(g, URCHIN_SPACING, 32, 200)).flatMap((st, i) => {
    const t = { x: -st.n.y * w, y: st.n.x * w }
    const base = along(st, unit * URCHIN_GAP)
    const tip = along(st, unit * (URCHIN_GAP + URCHIN_LENGTH * (0.55 + 0.45 * jitter(i))))
    return polygon([
      { x: base.x + t.x, y: base.y + t.y },
      tip,
      { x: base.x - t.x, y: base.y - t.y },
    ])
  })
}

function circle(c: Point, r: number): PathCommand[] {
  return ellipse(c.x, c.y, r, r)
}

/** 先端へ向かう角度と、その両側の付け根 a, b。付け根は本体の塗りに隠れる深さに置く */
function tailBase(g: BubbleGeometry, tail: Point) {
  const angle = Math.atan2((tail.y - g.cy) / (g.ry || 1), (tail.x - g.cx) / (g.rx || 1))
  const inset = unitOf(g) * TAIL_INSET
  const foot = (a: number) => {
    const st = ellipseAt(g, a)
    const toward = { x: g.cx - st.p.x, y: g.cy - st.p.y }
    const len = Math.hypot(toward.x, toward.y) || 1
    return { x: st.p.x + (toward.x / len) * inset, y: st.p.y + (toward.y / len) * inset }
  }
  return { angle, a: foot(angle - TAIL_SPREAD), b: foot(angle + TAIL_SPREAD) }
}

function tailOf(shape: Shape, g: BubbleGeometry, tail: Point): PathCommand[] {
  const { angle, a, b } = tailBase(g, tail)
  if (shape === 'thought') {
    const edge = ellipseAt(g, angle).p
    const unit = unitOf(g)
    return [
      { t: 0.3, r: unit * 0.18 },
      { t: 0.75, r: unit * 0.11 },
    ].flatMap(({ t, r }) =>
      circle({ x: edge.x + (tail.x - edge.x) * t, y: edge.y + (tail.y - edge.y) * t }, r),
    )
  }
  // 付け根の中点を原点、先端を u = 1、付け根 a, b を v = -1, 1 とする斜交座標
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const at = ([u, v]: readonly [number, number]): Point => ({
    x: m.x + (tail.x - m.x) * u + ((b.x - a.x) / 2) * v,
    y: m.y + (tail.y - m.y) * u + ((b.y - a.y) / 2) * v,
  })
  const shapes: Partial<Record<Shape, readonly (readonly [number, number])[]>> = {
    shout: [
      [0, -1],
      [0.45, -0.8],
      [0.42, -0.5],
      [1, 0],
      [0.6, 0.65],
      [0.58, 0.4],
      [0, 1],
    ],
    // 稲妻
    electronic: [
      [0, -1],
      [0, 1],
      [0.45, 0.17],
      [0.45, 0.83],
      [1, 0],
      [0.55, -0.17],
      [0.55, -0.83],
    ],
  }
  return polygon(
    (
      shapes[shape] ?? [
        [0, -1],
        [1, 0],
        [0, 1],
      ]
    ).map(at),
  )
}

/** shape の形で g に置いたフキダシの描き方 */
export function bubbleOutline(shape: Shape, g: BubbleGeometry): BubbleOutline {
  return {
    body: body(shape, g),
    tails: hasTail(shape) ? (g.tails ?? []).map((tail) => tailOf(shape, g, tail)) : [],
    ink: shape === 'urchin' ? urchinRays(g) : [],
    fill: shape !== 'none',
    line:
      shape === 'whisper' ? 'dashed' : shape === 'urchin' || shape === 'none' ? 'none' : 'solid',
  }
}

/** セリフを置く箱。輪郭の内側に収まるよう shape ごとに縮める */
export function bubbleTextBox(
  shape: Shape,
  g: BubbleGeometry,
): { x: number; y: number; w: number; h: number } {
  const f = isBoxShape(shape) ? { w: 0.85, h: 0.85 } : { w: 0.7, h: 0.75 }
  const w = g.rx * 2 * f.w
  const h = g.ry * 2 * f.h
  return { x: g.cx - w / 2, y: g.cy - h / 2, w, h }
}

/**
 * セリフの箱を、フキダシを切るコマの矩形 clip の内側に寄せる。見切れたフキダシでも
 * 見えている部分にセリフを置き、狭くなった分は割り付けが文字を小さくする。重ならなければ box をそのまま返す
 */
export function clipTextBox<B extends { x: number; y: number; w: number; h: number }>(
  box: B,
  clip: { x: number; y: number; w: number; h: number },
): B {
  const x = Math.max(box.x, clip.x)
  const y = Math.max(box.y, clip.y)
  const w = Math.min(box.x + box.w, clip.x + clip.w) - x
  const h = Math.min(box.y + box.h, clip.y + clip.h) - y
  return w > 0 && h > 0 ? { ...box, x, y, w, h } : box
}

/** 半径 rx, ry の本体（しっぽは除く）が、中心から単位ベクトル n の向きへどこまで出るか */
export function bubbleReach(shape: Shape, rx: number, ry: number, n: Point): number {
  if (isBoxShape(shape)) return Math.abs(n.x) * rx + Math.abs(n.y) * ry
  const unit = Math.min(rx, ry)
  const extra: Partial<Record<Shape, number>> = {
    // 二次ベジェの頂点は制御点の半分ほど外に出る
    thought: THOUGHT_BULGE / 2,
    tremble: TREMBLE_AMPLITUDE,
    urchin: URCHIN_GAP + URCHIN_LENGTH,
  }
  return Math.hypot(n.x * rx, n.y * ry) + unit * (extra[shape] ?? 0)
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest

  const g = { cx: 100, cy: 100, rx: 60, ry: 40, tails: [{ x: 100, y: 190 }] }
  const points = (cmds: PathCommand[]) =>
    cmds.flatMap((c) => (c.op === 'Z' ? [] : [{ x: c.x, y: c.y }]))
  const SHAPES = [
    'normal',
    'shout',
    'thought',
    'whisper',
    'tremble',
    'electronic',
    'urchin',
    'narration',
    'none',
  ] as const

  test('every outline is made of closed subpaths', () => {
    for (const shape of SHAPES) {
      const o = bubbleOutline(shape, g)
      for (const cmds of [o.body, ...o.tails, o.ink]) {
        if (cmds.length === 0) continue
        expect(cmds[0]?.op).toBe('M')
        expect(cmds.at(-1)?.op).toBe('Z')
      }
    }
  })

  test('narration is a square-cornered box with no tail', () => {
    const o = bubbleOutline('narration', g)
    expect(points(o.body)).toEqual([
      { x: 40, y: 60 },
      { x: 160, y: 60 },
      { x: 160, y: 140 },
      { x: 40, y: 140 },
    ])
    expect(o.tails).toEqual([])
  })

  test('narration, none and urchin take no tail; the rest do', () => {
    for (const shape of SHAPES) {
      expect(bubbleOutline(shape, g).tails.length > 0).toBe(hasTail(shape))
    }
    expect(SHAPES.filter((s) => !hasTail(s))).toEqual(['urchin', 'narration', 'none'])
  })

  test('how each shape is painted', () => {
    const style = (shape: (typeof SHAPES)[number]) => {
      const o = bubbleOutline(shape, g)
      return { fill: o.fill, line: o.line, ink: o.ink.length > 0 }
    }
    expect(style('normal')).toEqual({ fill: true, line: 'solid', ink: false })
    expect(style('whisper')).toEqual({ fill: true, line: 'dashed', ink: false })
    expect(style('urchin')).toEqual({ fill: true, line: 'none', ink: true })
    expect(style('none')).toEqual({ fill: false, line: 'none', ink: false })
  })

  describe('bumps keep their size on a tall bubble', () => {
    const tall = { cx: 0, cy: 0, rx: 10, ry: 40 }
    const gaps = (cmds: PathCommand[]) => {
      const ps = points(cmds)
      return ps.map((p, i) => {
        const q = ps[(i + 1) % ps.length] as Point
        return Math.hypot(q.x - p.x, q.y - p.y)
      })
    }

    test('electronic zigzag teeth are evenly spaced along the outline', () => {
      const d = gaps(bubbleOutline('electronic', tall).body)
      expect(Math.max(...d) / Math.min(...d)).toBeLessThan(1.3)
    })

    test('a taller bubble gets more thought bumps rather than longer ones', () => {
      const bumps = (shape: BubbleGeometry) =>
        bubbleOutline('thought', shape).body.filter((c) => c.op === 'Q').length
      expect(bumps(tall)).toBeGreaterThan(bumps({ cx: 0, cy: 0, rx: 10, ry: 10 }))
    })
  })

  test('shout spikes vary in depth but stay inside the ellipse', () => {
    const ps = points(bubbleOutline('shout', g).body)
    const r = ps.map((p) => Math.hypot((p.x - 100) / 60, (p.y - 100) / 40))
    expect(Math.max(...r)).toBeLessThanOrEqual(1 + 1e-9)
    const tips = r.filter((_, i) => i % 2 === 0)
    expect(Math.max(...tips) - Math.min(...tips)).toBeGreaterThan(0.02)
  })

  test('the outline is the same every time', () => {
    for (const shape of SHAPES) {
      expect(bubbleOutline(shape, g)).toEqual(bubbleOutline(shape, g))
    }
  })

  test('the tail reaches the tip, and its base sits inside the body', () => {
    for (const shape of ['normal', 'shout', 'electronic', 'tremble'] as const) {
      const ps = points(bubbleOutline(shape, g).tails[0] ?? [])
      expect(ps).toContainEqual({ x: 100, y: 190 })
      const r = ps.map((p) => Math.hypot((p.x - 100) / 60, (p.y - 100) / 40)).sort((a, b) => a - b)
      expect(r[1]).toBeLessThan(0.8)
    }
  })

  test('each tail runs from the body to its own tip, in the order of the tips', () => {
    const tips = [
      { x: 100, y: 190 },
      { x: 10, y: 20 },
    ]
    const alone = (shape: Shape, tip: Point) => bubbleOutline(shape, { ...g, tails: [tip] }).tails
    for (const shape of SHAPES.filter(hasTail)) {
      expect(bubbleOutline(shape, { ...g, tails: tips }).tails).toEqual(
        tips.flatMap((tip) => alone(shape, tip)),
      )
    }
    const [down, up] = bubbleOutline('normal', { ...g, tails: tips }).tails.map(points)
    expect(down).toContainEqual({ x: 100, y: 190 })
    expect(up).toContainEqual({ x: 10, y: 20 })
    expect(bubbleOutline('normal', { ...g, tails: [] }).tails).toEqual([])
    expect(bubbleOutline('narration', { ...g, tails: tips }).tails).toEqual([])
  })

  test('bubbleTextBox keeps more of a box-shaped body', () => {
    expect(bubbleTextBox('narration', g)).toEqual({ x: 49, y: 66, w: 102, h: 68 })
    expect(bubbleTextBox('none', g)).toEqual({ x: 49, y: 66, w: 102, h: 68 })
    expect(bubbleTextBox('normal', g)).toEqual({ x: 58, y: 70, w: 84, h: 60 })
  })

  test('clipTextBox keeps the visible part of the box, and the whole box when none is visible', () => {
    const box = { x: 58, y: 70, w: 84, h: 60 }
    expect(clipTextBox(box, { x: 100, y: 0, w: 200, h: 200 })).toEqual({
      x: 100,
      y: 70,
      w: 42,
      h: 60,
    })
    expect(clipTextBox(box, { x: 0, y: 0, w: 200, h: 200 })).toEqual(box)
    expect(clipTextBox(box, { x: 150, y: 0, w: 50, h: 200 })).toEqual(box)
  })

  test('bubbleReach covers the drawn outline in every direction', () => {
    for (const shape of SHAPES) {
      const o = bubbleOutline(shape, { ...g, tails: undefined })
      for (const p of points([...o.body, ...o.ink])) {
        const d = Math.hypot(p.x - 100, p.y - 100)
        if (d === 0) continue
        const n = { x: (p.x - 100) / d, y: (p.y - 100) / d }
        expect(d).toBeLessThanOrEqual(bubbleReach(shape, 60, 40, n) + 1e-6)
      }
    }
  })
}
