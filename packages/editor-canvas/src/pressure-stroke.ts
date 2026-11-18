import type { Point } from '@manga/schema'

type Mm = { x: number; y: number }

/** 筆圧の記録が無い点の筆圧。この筆圧で Stroke.width の太さになる */
export const DEFAULT_PRESSURE = 0.5
/** 筆圧 0 と 1 での太さ。Stroke.width に対する倍率 */
const MIN_SCALE = 0.25
const MAX_SCALE = 1.75

/** 筆圧 p での線の太さ。base は Stroke.width と同じ単位 */
export function pressureWidth(base: number, p: number): number {
  return base * (MIN_SCALE + (MAX_SCALE - MIN_SCALE) * p)
}

// SVG の d を短くする。0.001 mm は画面でも書き出しでも見えない
const f = (v: number) => Math.round(v * 1000) / 1000

/**
 * 点 b（半径 rb）の丸と、直前の点 a（半径 ra）から b までの台形を表す SVG の d。
 * 丸と台形は同じ向きに回るので、nonzero で塗れば重なりが抜けずに 1 本の線になる
 */
export function pressureSegment(a: Mm | null, ra: number, b: Mm, rb: number): string {
  const circle = `M${f(b.x - rb)} ${f(b.y)}a${f(rb)} ${f(rb)} 0 1 0 ${f(2 * rb)} 0a${f(rb)} ${f(rb)} 0 1 0 ${f(-2 * rb)} 0Z`
  if (!a) return circle
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return circle
  const nx = -dy / len
  const ny = dx / len
  return (
    `M${f(a.x + nx * ra)} ${f(a.y + ny * ra)}L${f(b.x + nx * rb)} ${f(b.y + ny * rb)}` +
    `L${f(b.x - nx * rb)} ${f(b.y - ny * rb)}L${f(a.x - nx * ra)} ${f(a.y - ny * ra)}Z${circle}`
  )
}

/**
 * 点ごとの筆圧で太さを変えた線の輪郭（SVG の d、mm）。fill で塗る。
 * points は 0..1 の正規化座標、strokeWidth は Stroke.width（ページ幅に対する比率）
 */
export function pressurePath(
  points: Point[],
  pressure: number[],
  strokeWidth: number,
  width: number,
  height: number,
): string {
  let d = ''
  let prev: { at: Mm; r: number } | null = null
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point
    const at = { x: p.x * width, y: p.y * height }
    const r = pressureWidth(strokeWidth * width, pressure[i] ?? DEFAULT_PRESSURE) / 2
    d += pressureSegment(prev?.at ?? null, prev?.r ?? r, at, r)
    prev = { at, r }
  }
  return d
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest

  describe('pressurePath', () => {
    test('the default pressure keeps Stroke.width', () => {
      expect(pressureWidth(2, DEFAULT_PRESSURE)).toBe(2)
      expect(pressureWidth(2, 0)).toBeLessThan(pressureWidth(2, 1))
    })

    test('a one-point stroke is a dot with the pressure radius', () => {
      expect(pressurePath([{ x: 0.5, y: 0.5 }], [1], 0.01, 100, 100)).toBe(
        'M49.125 50a0.875 0.875 0 1 0 1.75 0a0.875 0.875 0 1 0 -1.75 0Z',
      )
    })

    test('each later point adds a quad from the previous point and a dot', () => {
      const d = pressurePath(
        [
          { x: 0, y: 0 },
          { x: 0.1, y: 0 },
        ],
        [0, 1],
        0.01,
        100,
        100,
      )
      expect(d.match(/M/g)).toHaveLength(3)
      expect(d).toContain('M0 0.125L10 0.875L10 -0.875L0 -0.125Z')
    })

    test('missing pressures fall back to the default width', () => {
      expect(pressurePath([{ x: 0.5, y: 0.5 }], [], 0.01, 100, 100)).toBe(
        pressurePath([{ x: 0.5, y: 0.5 }], [DEFAULT_PRESSURE], 0.01, 100, 100),
      )
    })
  })
}
