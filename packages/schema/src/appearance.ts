import type { Page, Panel, Point } from './project'

/** 1 ページの幅に対する比率。見開きでも 1 ページ分の幅に対してとり、1 ページのときと同じ見た目にする */
const ROUND_RADIUS = 0.025
const WAVE_AMPLITUDE = 0.004
const WAVE_LENGTH = 0.035
const SOFT_DEPTH = 0.04
const CLOUD_HEIGHT = 0.008
const CLOUD_LENGTH = 0.045
const SOFT_STEPS = 12
const ROUND_SEGMENTS = 8
const WAVE_SEGMENTS = 12
const CLOUD_SEGMENTS = 10

type Frame = Panel['frame']

/** 紙の地の色。間白とタチキリの外に見える色で、ぼかし枠の絵もこの色へぼかす */
export const groundColor = (page: Pick<Page, 'ground'>): string =>
  page.ground === 'black' ? '#000' : '#fff'

/** 紙面全体に重ねるトーンの色。乗算で重ねるので、白は灰色になり黒ベタは黒のまま */
export const OVERLAY_COLORS: Record<NonNullable<Page['overlay']>, string> = { gray: '#bfbfbf' }

/** 枠線を引くか。none と soft は引かない */
export const hasFrameLine = (frame: Frame): boolean => frame !== 'none' && frame !== 'soft'

/**
 * 枠の形に合わせた輪郭。round は角を丸め、wavy は辺を波打たせ、cloud は辺を外へ膨らむ弧の連なりにした頂点列にし、
 * 他は outline のまま返す。絵の切り抜き、地の塗り、枠線をこの輪郭でとる。unit は 1 ページの幅で、outline と同じ単位
 */
export function frameOutline(outline: readonly Point[], frame: Frame, unit: number): Point[] {
  if (frame === 'round') return roundCorners(outline, unit * ROUND_RADIUS)
  if (frame === 'wavy') return waveEdges(outline, unit * WAVE_AMPLITUDE, unit * WAVE_LENGTH)
  if (frame === 'cloud') return cloudEdges(outline, unit * CLOUD_HEIGHT, unit * CLOUD_LENGTH)
  return [...outline]
}

/** 隣の辺の半分を超えない半径で、各頂点を二次ベジェで丸める */
function roundCorners(outline: readonly Point[], radius: number): Point[] {
  const n = outline.length
  const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
  return outline.flatMap((v, i) => {
    const prev = outline[(i + n - 1) % n] as Point
    const next = outline[(i + 1) % n] as Point
    const r = Math.min(radius, len(prev, v) / 2, len(v, next) / 2)
    if (r <= 0) return [v]
    const toward = (p: Point) => {
      const d = len(v, p)
      return { x: v.x + ((p.x - v.x) * r) / d, y: v.y + ((p.y - v.y) * r) / d }
    }
    const a = toward(prev)
    const b = toward(next)
    return Array.from({ length: ROUND_SEGMENTS + 1 }, (_, k) => {
      const t = k / ROUND_SEGMENTS
      const u = 1 - t
      return {
        x: u * u * a.x + 2 * u * t * v.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * v.y + t * t * b.y,
      }
    })
  })
}

/** 各辺を、頂点で振れ幅 0 になる整数個の波にする。角は元の位置に残る */
function waveEdges(outline: readonly Point[], amplitude: number, wavelength: number): Point[] {
  return outline.flatMap((a, i) => {
    const b = outline[(i + 1) % outline.length] as Point
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len === 0) return [a]
    const waves = Math.max(1, Math.round(len / wavelength))
    const steps = waves * WAVE_SEGMENTS
    const nx = -dy / len
    const ny = dx / len
    return Array.from({ length: steps }, (_, k) => {
      const t = k / steps
      const off = amplitude * Math.sin(2 * Math.PI * waves * t)
      return { x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off }
    })
  })
}

/**
 * outline を height だけ内側へ寄せ、その各辺を、外へ height だけ膨らむ整数個の弧にする。
 * 弧の頂が元の辺に届くので、雲形でもコマの輪郭の外へ出ず、隣のコマと重ならない
 */
function cloudEdges(outline: readonly Point[], height: number, length: number): Point[] {
  // 頂点の並びが時計回りか反時計回りかで、辺の左手の法線が内側か外側かが変わる
  const inward = signedArea(outline) > 0 ? 1 : -1
  const inner = insetPolygon(outline, height * inward)
  return inner.flatMap((a, i) => {
    const b = inner[(i + 1) % inner.length] as Point
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len === 0) return [a]
    const bumps = Math.max(1, Math.round(len / length))
    const steps = bumps * CLOUD_SEGMENTS
    const nx = (-dy / len) * -inward
    const ny = (dx / len) * -inward
    return Array.from({ length: steps }, (_, k) => {
      const t = k / steps
      const off = height * Math.sqrt(Math.abs(Math.sin(Math.PI * bumps * t)))
      return { x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off }
    })
  })
}

/** 靴紐の公式の 2 倍。y が下向きの座標で、時計回りに見える並びが正 */
function signedArea(outline: readonly Point[]): number {
  return outline.reduce((sum, a, i) => {
    const b = outline[(i + 1) % outline.length] as Point
    return sum + a.x * b.y - b.x * a.y
  }, 0)
}

/**
 * 各辺を左手の法線の向きへ d だけ平行に動かし、隣り合う辺の交点を新しい頂点にする。
 * 隣の辺と平行なら交点が無いので、頂点をそのまま法線の向きへ動かす
 */
function insetPolygon(outline: readonly Point[], d: number): Point[] {
  const n = outline.length
  const shifted = outline.map((a, i) => {
    const b = outline[(i + 1) % n] as Point
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = (-(b.y - a.y) / len) * d
    const ny = ((b.x - a.x) / len) * d
    return { a: { x: a.x + nx, y: a.y + ny }, b: { x: b.x + nx, y: b.y + ny }, nx, ny }
  })
  return shifted.map((cur, i) => {
    const prev = shifted[(i + n - 1) % n] as (typeof shifted)[number]
    const r = { x: prev.b.x - prev.a.x, y: prev.b.y - prev.a.y }
    const s = { x: cur.b.x - cur.a.x, y: cur.b.y - cur.a.y }
    const cross = r.x * s.y - r.y * s.x
    const v = outline[i] as Point
    if (Math.abs(cross) < 1e-12) return { x: v.x + cur.nx, y: v.y + cur.ny }
    const t = ((cur.a.x - prev.a.x) * s.y - (cur.a.y - prev.a.y) * s.x) / cross
    return { x: prev.a.x + r.x * t, y: prev.a.y + r.y * t }
  })
}

/**
 * ぼかし枠で、輪郭の内側に重ねて引く線（輪郭で切り抜いて地の色で引く）。外側から内側へ不透明度が線形に下がるよう、
 * k 本目は幅 2·depth·k/N、不透明度 1/k にする。重なった本数 c の所の不透明度が 1 − Π(1 − 1/k) = c/N になるため。
 * unit は 1 ページの幅
 */
export function softEdgeStrokes(unit: number): { width: number; alpha: number }[] {
  return Array.from({ length: SOFT_STEPS }, (_, i) => ({
    width: (2 * unit * SOFT_DEPTH * (i + 1)) / SOFT_STEPS,
    alpha: 1 / (i + 1),
  }))
}

/**
 * 色調ごとの色の行列。SVG の feColorMatrix と同じ 4×5 の並びで、オフセットは 0〜1 の値。
 * エディタは feColorMatrix に、レンダラは画素ごとの計算にこの行列を渡し、同じ色にする
 */
export const TONE_MATRICES: Record<NonNullable<Page['tone']>, readonly number[]> = {
  // CSS の sepia(1) と同じ係数
  sepia: [
    0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0,
  ],
  // 輝度に落として 6 割に縮め、白へ 4 割寄せる
  faded: [
    0.12756, 0.42912, 0.04332, 0, 0.4, 0.12756, 0.42912, 0.04332, 0, 0.4, 0.12756, 0.42912, 0.04332,
    0, 0.4, 0, 0, 0, 1, 0,
  ],
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]

  test('frameOutline keeps the outline for plain frames', () => {
    expect(frameOutline(square, undefined, 1)).toEqual(square)
    expect(frameOutline(square, 'dashed', 1)).toEqual(square)
  })

  test('frameOutline rounds the corners inside the outline and keeps the edge midpoints', () => {
    const round = frameOutline(square, 'round', 4)
    expect(round).not.toContainEqual({ x: 0, y: 0 })
    expect(round.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true)
    // 半径 0.1 は辺の半分より小さいので、角から 0.1 の点で丸めが始まる
    expect(round[0]?.x).toBeCloseTo(0)
    expect(round[0]?.y).toBeCloseTo(0.1)
  })

  test('frameOutline waves each edge with zero swing at the vertices', () => {
    const wavy = frameOutline(square, 'wavy', 1)
    expect(wavy).toContainEqual({ x: 0, y: 0 })
    expect(wavy.length).toBeGreaterThan(square.length * 10)
    const swing = Math.max(
      ...wavy.filter((p) => p.x > 0.1 && p.x < 0.9 && p.y < 0.5).map((p) => Math.abs(p.y)),
    )
    expect(swing).toBeGreaterThan(0)
    expect(swing).toBeLessThanOrEqual(WAVE_AMPLITUDE + 1e-9)
  })

  test('frameOutline puffs each edge into arcs that stay inside the outline and touch it', () => {
    for (const outline of [square, [...square].reverse()]) {
      const cloud = frameOutline(outline, 'cloud', 1)
      expect(cloud.length).toBeGreaterThan(square.length * 10)
      expect(
        cloud.every((p) => p.x >= -1e-9 && p.x <= 1 + 1e-9 && p.y >= -1e-9 && p.y <= 1 + 1e-9),
      ).toBe(true)
      // 上の辺の弧の頂は元の辺に届き、弧の継ぎ目は CLOUD_HEIGHT だけ内側にある
      const top = cloud.filter((p) => p.x > 0.1 && p.x < 0.9 && p.y < 0.5).map((p) => p.y)
      expect(Math.min(...top)).toBeCloseTo(0, 6)
      expect(Math.max(...top)).toBeCloseTo(CLOUD_HEIGHT, 6)
    }
  })

  test('softEdgeStrokes stack to an opacity that falls linearly inward', () => {
    const strokes = softEdgeStrokes(1)
    const opacityAt = (covered: number) =>
      1 - strokes.slice(strokes.length - covered).reduce((p, s) => p * (1 - s.alpha), 1)
    expect(opacityAt(SOFT_STEPS)).toBeCloseTo(1)
    expect(opacityAt(SOFT_STEPS / 2)).toBeCloseTo(0.5)
    expect(strokes.at(-1)?.width).toBeCloseTo(2 * SOFT_DEPTH)
  })

  test('hasFrameLine is false only for none and soft', () => {
    expect(
      [undefined, 'round', 'wavy', 'dashed', 'double', 'cloud'].every((f) =>
        hasFrameLine(f as Frame),
      ),
    ).toBe(true)
    expect(hasFrameLine('none')).toBe(false)
    expect(hasFrameLine('soft')).toBe(false)
  })
}
