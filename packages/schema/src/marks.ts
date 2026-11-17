import type { FocusKind, FocusMark, FocusPoint, Panel, Point, Rect } from './project'

/** 漫符の種類の既定 */
export const DEFAULT_MARK: FocusMark = 'sweat'

/** 漫符の大きさ。コマの短辺に対する比率で、weight 0 で MIN、1 で MAX */
const MARK_SIZE_MIN = 0.1
const MARK_SIZE_MAX = 0.3

/**
 * 画面で選べる焦点の種類。生成のための印で紙面に描かない face と keyObject、紙面に描ける sfx を並べる。
 * mark は漫符の種類を選ぶ欄がまだ無く、選んでも汗しか描けないので並べない
 */
export const AVAILABLE_FOCUS_KINDS = [
  'face',
  'keyObject',
  'sfx',
] as const satisfies readonly FocusKind[]

/** 漫符の種類。指定が無ければ DEFAULT_MARK */
export function focusMark(focus: Pick<FocusPoint, 'mark'>): FocusMark {
  return focus.mark ?? DEFAULT_MARK
}

/**
 * 漫符の大きさ。weight から描き文字と同じくコマの短辺に対する比率で決める。
 * w と h はコマの矩形の大きさで、返す値も同じ単位
 */
export function markSize(focus: Pick<FocusPoint, 'weight'>, w: number, h: number): number {
  return Math.min(w, h) * (MARK_SIZE_MIN + (MARK_SIZE_MAX - MARK_SIZE_MIN) * focus.weight)
}

/**
 * コマの漫符（kind が mark の焦点）を、塗りつぶす多角形の列で返す。box はコマの rect を描く先の単位にした矩形で、
 * 返す頂点も同じ単位。漫符はコマの輪郭の外まで出ることがあるので、呼び出し側が輪郭で切る。塗る色は効果線と同じ effectInk。
 * 大きさは markSize、傾きは焦点の rotation（度、正は時計回り）で、焦点の位置を中心に回す。
 * sigh だけは焦点の位置を口元とみなし、そこから右へ息を吐き出す形にする。
 * 呼び出し側は多角形をまとめて nonzero で塗るので、重なる部品で穴が開かないよう多角形の向きを揃えて返す。
 * unit（1 ページの幅）は effectLines と引数を揃えるために受け取り、大きさはコマから決めるので使わない
 */
export function markShapes(
  panel: Pick<Panel, 'focusPoints'>,
  box: Rect,
  _unit: number,
): Point[][] {
  if (box.w <= 0 || box.h <= 0) return []
  return panel.focusPoints
    .filter((f) => f.kind === 'mark')
    .flatMap((f) => {
      const size = markSize(f, box.w, box.h)
      const center = { x: box.x + f.pos.x * box.w, y: box.y + f.pos.y * box.h }
      const turn = ((f.rotation ?? 0) * Math.PI) / 180
      const cos = Math.cos(turn)
      const sin = Math.sin(turn)
      return markPolygons(focusMark(f), f.weight).map((poly) =>
        clockwise(
          poly.map((p) => ({
            x: center.x + (p.x * cos - p.y * sin) * size,
            y: center.y + (p.x * sin + p.y * cos) * size,
          })),
        ),
      )
    })
}

/**
 * 1 つの漫符の多角形。焦点の位置を原点、漫符の大きさを 1 とした座標で、y は下向き。
 * sigh 以外は原点のまわりに置く
 */
function markPolygons(mark: FocusMark, weight: number): Point[][] {
  switch (mark) {
    case 'sweat':
      return sweat(weight)
    case 'anger':
      return anger()
    case 'question':
      return question()
    case 'exclaim':
      return exclaim()
    case 'sigh':
      return sigh()
  }
}

/** 汗の粒。weight が 1/3 未満で 1 粒、2/3 未満で 2 粒、それ以上で 3 粒にし、大きく描くほど焦りも強く見せる */
const SWEAT_DROPS = [
  { x: 0, y: 0, h: 0.7 },
  { x: 0.44, y: 0.22, h: 0.45 },
  { x: -0.4, y: 0.3, h: 0.35 },
]

function sweat(weight: number): Point[][] {
  const count = Math.min(SWEAT_DROPS.length, 1 + Math.floor(weight * SWEAT_DROPS.length))
  return SWEAT_DROPS.slice(0, count).map((d) => drop(d.x, d.y, d.h))
}

/** 先を上に尖らせた涙形。(cx, cy) は高さの中央、h は高さ */
function drop(cx: number, cy: number, h: number): Point[] {
  const r = h / 2
  return samples(40, false).map((u) => {
    const t = 2 * Math.PI * u
    return { x: cx + r * Math.sin(t) * Math.sin(t / 2), y: cy - r * Math.cos(t) }
  })
}

/**
 * 怒りマーク。中心を囲む 4 つの角に、中心へ膨らむ弧を 1 本ずつ置く。
 * 弧の端どうしは軸の上で離して、間の隙間が十字に見えるようにする
 */
function anger(): Point[][] {
  const d = 0.42
  const r = 0.36
  return [
    [1, -1],
    [-1, -1],
    [-1, 1],
    [1, 1],
  ].map(([sx = 1, sy = 1]) => {
    const middle = Math.atan2(-sy, -sx)
    const path = samples(24, true).map((u) => {
      const a = middle + (u - 0.5) * (Math.PI / 2)
      return { x: sx * d + r * Math.cos(a), y: sy * d + r * Math.sin(a) }
    })
    return stroke(path, (u) => 0.025 + 0.045 * Math.sin(Math.PI * u))
  })
}

/** ハテナ。上の鉤、まっすぐ下りる軸、下の点の 3 つの部品を重ねる */
function question(): Point[][] {
  const hook = samples(32, true).map((u) => {
    const a = Math.PI + 0.35 + u * (1.5 * Math.PI - 0.35)
    return { x: 0.2 * Math.cos(a), y: -0.22 + 0.2 * Math.sin(a) }
  })
  return [
    stroke(hook, () => 0.075),
    [
      { x: -0.075, y: -0.02 },
      { x: 0.075, y: -0.02 },
      { x: 0.075, y: 0.22 },
      { x: -0.075, y: 0.22 },
    ],
    circle(0, 0.39, 0.09),
  ]
}

/** ビックリ。上が丸く下へ細る棒と、下の点 */
function exclaim(): Point[][] {
  const cap = samples(16, true).map((u) => {
    const a = Math.PI * (1 + u)
    return { x: 0.1 * Math.cos(a), y: -0.4 + 0.1 * Math.sin(a) }
  })
  return [
    [...cap, { x: 0.045, y: 0.22 }, { x: -0.045, y: 0.22 }],
    circle(0, 0.39, 0.09),
  ]
}

/**
 * ため息。原点（口元）から細く出て右へ流れ、下から上へ 1 周半巻き込む息。
 * 渦の 1 周で縮む半径を線の太さより大きくして、巻いた線どうしが重ならないようにする
 */
function sigh(): Point[][] {
  const cx = 0.55
  const cy = -0.12
  const outer = 0.2
  const inner = 0.06
  const turns = 1.5
  const tail = samples(16, false).map((u) => ({
    x: cx * u,
    y: (cy + outer) * (2 * u - u * u),
  }))
  const curl = samples(48, true).map((u) => {
    const a = Math.PI / 2 - u * turns * 2 * Math.PI
    const r = outer + (inner - outer) * u
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  })
  const path = [...tail, ...curl]
  return [stroke(path, (u) => (u < 0.3 ? 0.012 + (0.028 * u) / 0.3 : 0.04 - (0.02 * (u - 0.3)) / 0.7))]
}

/** 0 から 1 までを n 等分した値。last が false なら 1 を含めない */
function samples(n: number, last: boolean): number[] {
  return Array.from({ length: last ? n + 1 : n }, (_, i) => i / n)
}

function circle(cx: number, cy: number, r: number): Point[] {
  return samples(20, false).map((u) => ({
    x: cx + r * Math.cos(2 * Math.PI * u),
    y: cy + r * Math.sin(2 * Math.PI * u),
  }))
}

/**
 * 折れ線を太らせた多角形。halfWidth は折れ線の始まりからの割合（0〜1）に対する線の太さの半分。
 * 両端は線に直角に切る
 */
function stroke(path: readonly Point[], halfWidth: (u: number) => number): Point[] {
  const last = path.length - 1
  const left: Point[] = []
  const right: Point[] = []
  path.forEach((p, i) => {
    const prev = path[Math.max(0, i - 1)] as Point
    const next = path[Math.min(last, i + 1)] as Point
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    const hw = halfWidth(last === 0 ? 0 : i / last)
    const nx = (-dy / len) * hw
    const ny = (dx / len) * hw
    left.push({ x: p.x + nx, y: p.y + ny })
    right.push({ x: p.x - nx, y: p.y - ny })
  })
  return [...left, ...right.reverse()]
}

/** 頂点の並びを、y が下向きの座標で時計回り（符号付き面積が正）に揃える */
function clockwise(poly: Point[]): Point[] {
  return signedArea(poly) < 0 ? poly.reverse() : poly
}

function signedArea(poly: readonly Point[]): number {
  let sum = 0
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length] as Point
    sum += p.x * q.y - q.x * p.y
  })
  return sum / 2
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const focus = (patch: Partial<FocusPoint>): FocusPoint => ({
    id: 'fp_1',
    kind: 'mark',
    label: '',
    pos: { x: 0.5, y: 0.5 },
    weight: 0.5,
    ...patch,
  })
  const box: Rect = { x: 10, y: 20, w: 100, h: 50 }
  const MARKS = ['sweat', 'anger', 'question', 'exclaim', 'sigh'] as const
  const shapes = (patch: Partial<FocusPoint>) =>
    markShapes({ focusPoints: [focus(patch)] }, box, 100)
  const bounds = (polys: readonly Point[][]) => {
    const xs = polys.flat().map((p) => p.x)
    const ys = polys.flat().map((p) => p.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }
  const centroid = (poly: readonly Point[]) => ({
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  })
  /** 焦点の位置（box の中央） */
  const center = { x: 60, y: 45 }

  test('focusMark falls back to sweat', () => {
    expect(focusMark({})).toBe('sweat')
    expect(focusMark({ mark: 'anger' })).toBe('anger')
  })

  test('markSize scales with weight from 0.1 to 0.3 of the short side', () => {
    expect(markSize({ weight: 0 }, 200, 100)).toBeCloseTo(10)
    expect(markSize({ weight: 1 }, 200, 100)).toBeCloseTo(30)
    expect(markSize({ weight: 0.5 }, 100, 300)).toBeCloseTo(20)
  })

  test('markShapes draws only mark focus points, and nothing in an empty box', () => {
    const focusPoints = [
      focus({ id: 'fp_sfx', kind: 'sfx', label: 'ドン' }),
      focus({ id: 'fp_face', kind: 'face' }),
      focus({ id: 'fp_key', kind: 'keyObject' }),
    ]
    expect(markShapes({ focusPoints }, box, 100)).toEqual([])
    expect(markShapes({ focusPoints: [focus({})] }, { ...box, w: 0 }, 100)).toEqual([])
    expect(markShapes({ focusPoints: [focus({})] }, box, 100)).toEqual(shapes({ mark: 'sweat' }))
  })

  describe.each(MARKS)('%s', (mark) => {
    test('is filled polygons with finite vertices, all wound the same way', () => {
      const polys = shapes({ mark })
      expect(polys.length).toBeGreaterThan(0)
      for (const poly of polys) {
        expect(poly.length).toBeGreaterThanOrEqual(3)
        for (const p of poly) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
        }
        expect(signedArea(poly)).toBeGreaterThan(0)
      }
    })

    test('follows the focus position', () => {
      const here = shapes({ mark, pos: { x: 0.3, y: 0.4 } })
      const there = shapes({ mark, pos: { x: 0.6, y: 0.8 } })
      const a = bounds(here)
      const b = bounds(there)
      expect(b.x - a.x).toBeCloseTo(30)
      expect(b.y - a.y).toBeCloseTo(20)
      expect(b.w).toBeCloseTo(a.w)
      expect(b.h).toBeCloseTo(a.h)
    })

    test('grows with weight in proportion to markSize', () => {
      const small = bounds(shapes({ mark, weight: 0 }))
      const large = bounds(shapes({ mark, weight: 1 }))
      // 汗だけは weight で粒の数も変わるので、大きくなることだけを見る
      if (mark === 'sweat') {
        expect(large.h).toBeGreaterThan(small.h * 3)
      } else {
        expect(large.w / small.w).toBeCloseTo(3)
        expect(large.h / small.h).toBeCloseTo(3)
      }
    })

    test('turns clockwise around the focus point by rotation', () => {
      const upright = shapes({ mark })
      const turned = shapes({ mark, rotation: 90 })
      expect(turned).toHaveLength(upright.length)
      turned.forEach((poly, i) => {
        const expected = (upright[i] as Point[]).map((p) => ({
          x: center.x - (p.y - center.y),
          y: center.y + (p.x - center.x),
        }))
        poly.forEach((p, j) => {
          const e = expected[j] as Point
          expect(p.x).toBeCloseTo(e.x)
          expect(p.y).toBeCloseTo(e.y)
        })
      })
    })
  })

  test('sweat has 1 to 3 teardrops by weight, each pointed at the top', () => {
    expect(shapes({ mark: 'sweat', weight: 0 })).toHaveLength(1)
    expect(shapes({ mark: 'sweat', weight: 0.3 })).toHaveLength(1)
    expect(shapes({ mark: 'sweat', weight: 0.5 })).toHaveLength(2)
    expect(shapes({ mark: 'sweat', weight: 1 })).toHaveLength(3)
    for (const poly of shapes({ mark: 'sweat', weight: 1 })) {
      const b = bounds([poly])
      const top = poly.reduce((a, p) => (p.y < a.y ? p : a))
      const bottom = poly.reduce((a, p) => (p.y > a.y ? p : a))
      const widest = poly.reduce((a, p) => (p.x > a.x ? p : a))
      // 先は細く、底は丸く広い
      expect(b.h).toBeGreaterThan(b.w)
      expect(widest.y).toBeGreaterThan(b.y + b.h / 2)
      expect(top.x).toBeCloseTo(bottom.x)
    }
  })

  test('anger is 4 arcs, one in each quadrant around the focus, leaving the center open', () => {
    const polys = shapes({ mark: 'anger' })
    expect(polys).toHaveLength(4)
    const quadrants = polys.map((poly) => {
      const c = centroid(poly)
      return `${Math.sign(c.x - center.x)},${Math.sign(c.y - center.y)}`
    })
    expect(new Set(quadrants)).toEqual(new Set(['1,-1', '-1,-1', '-1,1', '1,1']))
    for (const poly of polys) {
      for (const p of poly) {
        expect(Math.hypot(p.x - center.x, p.y - center.y)).toBeGreaterThan(1)
      }
    }
  })

  test('question and exclaim end in a dot below the focus', () => {
    const q = shapes({ mark: 'question' })
    const e = shapes({ mark: 'exclaim' })
    expect(q).toHaveLength(3)
    expect(e).toHaveLength(2)
    for (const polys of [q, e]) {
      const dot = centroid(polys.at(-1) as Point[])
      expect(dot.x).toBeCloseTo(center.x)
      expect(dot.y).toBeGreaterThan(center.y)
      // 点の上は、本体と点の間を空ける
      const body = bounds(polys.slice(0, -1))
      expect(bounds([polys.at(-1) as Point[]]).y).toBeGreaterThan(body.y + body.h)
    }
    // ハテナの鉤は軸より右へ張り出す
    const hook = bounds([q[0] as Point[]])
    const stem = bounds([q[1] as Point[]])
    expect(hook.x + hook.w).toBeGreaterThan(stem.x + stem.w)
  })

  test('sigh starts thin at the focus as the mouth and curls away to the right', () => {
    const polys = shapes({ mark: 'sigh' })
    expect(polys).toHaveLength(1)
    const poly = polys[0] as Point[]
    const nearest = Math.min(...poly.map((p) => Math.hypot(p.x - center.x, p.y - center.y)))
    expect(nearest).toBeLessThan(0.5)
    const b = bounds(polys)
    expect(b.x).toBeCloseTo(center.x, 0)
    expect(b.x + b.w).toBeGreaterThan(center.x + 5)
    // 口元より上まで巻き上がる
    expect(b.y).toBeLessThan(center.y - 2)
  })
}
