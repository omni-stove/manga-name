import type { Panel, Point, ReadingDirection, Sweep } from '@manga/schema'

/** `Panel.sweep` が無いときの視線経路 */
const DEFAULT_SWEEP: Sweep = { kind: 'centre', y: 0.5 }

/** コマ内座標（0..1）をページ座標に変換する */
const toPage = (panel: Panel, p: Point): Point => ({
  x: panel.rect.x + p.x * panel.rect.w,
  y: panel.rect.y + p.y * panel.rect.h,
})

/**
 * コマの視線経路をページ座標の点列で返す。入口が先頭、出口が末尾。
 * `centre` は入口側端から出口側端への `y = sweep.y` の水平線（rtl は右端から左端）。
 * `polyline` は指定点（コマ内座標）をそのままページ座標にしたもの。direction では反転しない。
 * `Panel.sweep` が無い、または polyline の点が 0 個のときは既定の centre（y = 0.5）。
 */
export function sweepPath(panel: Panel, direction: ReadingDirection): Point[] {
  const sweep = panel.sweep ?? DEFAULT_SWEEP
  if (sweep.kind === 'polyline' && sweep.points.length > 0) {
    return sweep.points.map((p) => toPage(panel, p))
  }
  const y = sweep.kind === 'centre' ? sweep.y : DEFAULT_SWEEP.y
  const [from, to] = direction === 'rtl' ? [1, 0] : [0, 1]
  return [toPage(panel, { x: from, y }), toPage(panel, { x: to, y })]
}

/**
 * コマ内座標の点 `pos` を、そのコマの視線経路に射影する。
 * `t` は射影点の経路上の位置を 0..1 に正規化したもので、入口が 0、出口が 1。
 * `distance` は点から射影点までのページ座標での距離を、コマの高さで割った値。
 * 経路の長さが 0 のときは t = 0。
 */
export function projectOntoSweep(
  panel: Panel,
  pos: Point,
  direction: ReadingDirection,
): { t: number; distance: number } {
  const path = sweepPath(panel, direction)
  const target = toPage(panel, pos)

  let total = 0
  let bestAlong = 0
  let bestDistance = Number.POSITIVE_INFINITY
  const first = path[0]
  if (path.length === 1 && first) {
    bestDistance = Math.hypot(target.x - first.x, target.y - first.y)
  }

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    const dot = (target.x - a.x) * dx + (target.y - a.y) * dy
    const u = length === 0 ? 0 : Math.min(1, Math.max(0, dot / (length * length)))
    const distance = Math.hypot(target.x - (a.x + u * dx), target.y - (a.y + u * dy))
    // 同距離なら先の線分を採る。折り返す経路で自己交差する点の t が小さい側に倒れるのを避ける
    if (distance <= bestDistance) {
      bestDistance = distance
      bestAlong = total + u * length
    }
    total += length
  }

  return {
    t: total === 0 ? 0 : bestAlong / total,
    distance: panel.rect.h === 0 ? 0 : bestDistance / panel.rect.h,
  }
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  const panel = (sweep?: Sweep): Panel =>
    ({ id: 'pn', rect: { x: 0.5, y: 0.2, w: 0.4, h: 0.4 }, sweep }) as Panel

  test('centre sweep runs entrance edge to exit edge in page coordinates', () => {
    expect(sweepPath(panel(), 'rtl')).toEqual([
      { x: 0.9, y: 0.4 },
      { x: 0.5, y: 0.4 },
    ])
    expect(sweepPath(panel({ kind: 'centre', y: 0.25 }), 'ltr')).toEqual([
      { x: 0.5, y: 0.3 },
      { x: 0.9, y: 0.3 },
    ])
  })

  test('centre projection: rtl gives t = 1 - x, distance = |y - sweep.y|', () => {
    const p = panel({ kind: 'centre', y: 0.5 })
    const { t, distance } = projectOntoSweep(p, { x: 0.3, y: 0.8 }, 'rtl')
    expect(t).toBeCloseTo(0.7)
    expect(distance).toBeCloseTo(0.3)
  })

  test('ltr flips t: t = x', () => {
    const p = panel()
    expect(projectOntoSweep(p, { x: 0.3, y: 0.5 }, 'ltr').t).toBeCloseTo(0.3)
    expect(projectOntoSweep(p, { x: 0.3, y: 0.5 }, 'rtl').t).toBeCloseTo(0.7)
  })

  test('polyline sweep keeps the given order and projects onto the nearest segment', () => {
    const p = panel({
      kind: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    })
    expect(sweepPath(p, 'ltr')).toEqual(sweepPath(p, 'rtl'))
    expect(sweepPath(p, 'rtl')).toEqual([
      { x: 0.5, y: 0.2 },
      { x: 0.9, y: 0.2 },
      { x: 0.9, y: 0.6 },
    ])
    // 第 1 線分の中点: 経路の 1/4
    const first = projectOntoSweep(p, { x: 0.5, y: 0.2 }, 'rtl')
    expect(first.t).toBeCloseTo(0.25)
    expect(first.distance).toBeCloseTo(0.2)
    // 第 2 線分の中点より内側: 経路の 3/4、距離は 0.4 * 0.5 / 0.4
    const second = projectOntoSweep(p, { x: 0.5, y: 0.5 }, 'rtl')
    expect(second.t).toBeCloseTo(0.75)
    expect(second.distance).toBeCloseTo(0.5)
  })

  test('degenerate sweeps do not produce NaN', () => {
    const single = panel({ kind: 'polyline', points: [{ x: 0.5, y: 0.5 }] })
    expect(projectOntoSweep(single, { x: 0.5, y: 0.5 }, 'rtl')).toEqual({ t: 0, distance: 0 })
    const empty = panel({ kind: 'polyline', points: [] })
    expect(sweepPath(empty, 'rtl')).toEqual(sweepPath(panel(), 'rtl'))
  })

  test('does not mutate frozen input', () => {
    const frozen = Object.freeze({
      ...panel({ kind: 'centre', y: 0.5 }),
      rect: Object.freeze({ x: 0.5, y: 0.2, w: 0.4, h: 0.4 }),
    })
    expect(() => projectOntoSweep(frozen, { x: 0.1, y: 0.1 }, 'rtl')).not.toThrow()
  })
}
