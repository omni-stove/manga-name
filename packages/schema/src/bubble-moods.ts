import type { BubbleOutline } from './bubble-outline'
import {
  along,
  type BubbleGeometry,
  countAlong,
  jitter,
  type PathCommand,
  polygon,
  stations,
  unitOf,
} from './bubble-path'
import type { Bubble } from './project'

/** 声の調子を輪郭で表すフキダシの形。cold は角の尖った冷たい声、weak はしぼんだ弱々しい声 */
export type BubbleMood = Extract<Bubble['shape'], 'cold' | 'weak'>

const MOODS: readonly Bubble['shape'][] = ['cold', 'weak'] satisfies BubbleMood[]

export const isBubbleMood = (shape: Bubble['shape']): shape is BubbleMood => MOODS.includes(shape)

// 大きさはどれも min(rx, ry) に対する比率。bubble-outline の他の形と同じく、縦長や横長でも角や凹みの大きさを揃える
/** cold の角どうしの間隔。角の間に 1 つずつ浅い谷を置く */
const COLD_SPACING = 0.9
/** cold の角を楕円から外へ出す長さの最大。揺らぎで半分から最大までにばらつく */
const COLD_POINT = 0.12
/** cold の谷を楕円から内へ入れる深さの最大 */
const COLD_NOTCH = 0.05
/** weak の輪郭を刻む点の間隔。凹みが角ばって見えない細かさにする */
const WEAK_STEP = 0.06
/** weak の凹みどうしの間隔。周をこの長さの区画に分け、各区画の中ほどに 1 つ凹みを置く */
const WEAK_DENT_SPACING = 1.6
/** weak の凹みの幅。区画に対する比率で、残りは楕円のまま残してところどころ凹んで見せる */
const WEAK_DENT_WIDTH = 0.5
const WEAK_DENT_MIN = 0.06
const WEAK_DENT_MAX = 0.16

/**
 * cold の本体。楕円の周に角と谷を交互に置いた多角形で、角は外へ、谷はわずかに内へずらす。
 * 角ごとに出方を揺らし、均一な歯車や星形に見えないようにする
 */
function coldBody(g: BubbleGeometry): PathCommand[] {
  const unit = unitOf(g)
  const s = stations(g, countAlong(g, COLD_SPACING, 7, 30) * 2)
  return polygon(
    s.map((st, i) =>
      i % 2 === 0
        ? along(st, unit * COLD_POINT * (0.5 + 0.5 * jitter(i)))
        : along(st, -unit * COLD_NOTCH * jitter(i)),
    ),
  )
}

/**
 * weak の本体。楕円の周を区画に分け、各区画の中ほどを滑らかに内へ凹ませた輪郭。
 * 凹みの位置と深さを区画ごとに揺らし、どこも外へは出さない
 */
function weakBody(g: BubbleGeometry): PathCommand[] {
  const unit = unitOf(g)
  const s = stations(g, countAlong(g, WEAK_STEP, 64, 360))
  const slots = countAlong(g, WEAK_DENT_SPACING, 4, 16)
  const half = WEAK_DENT_WIDTH / 2
  return polygon(
    s.map((st, i) => {
      const u = (i / s.length) * slots
      const k = Math.floor(u)
      // 凹みが区画の端をまたがないよう、中心は区画の [half, 1 - half] に置く
      const centre = half + (1 - WEAK_DENT_WIDTH) * jitter(k * 7 + 3)
      const d = (u - k - centre) / half
      if (Math.abs(d) >= 1) return st.p
      const depth = WEAK_DENT_MIN + (WEAK_DENT_MAX - WEAK_DENT_MIN) * jitter(k * 13 + 5)
      return along(st, -unit * depth * Math.cos((d * Math.PI) / 2) ** 2)
    }),
  )
}

/**
 * mood の形で g に置いたフキダシの描き方。normal は同じ g に置いた普通のフキダシの描き方で、
 * 本体だけを差し替え、しっぽと塗りと線は普通の形のまま使う
 */
export function moodOutline(
  mood: BubbleMood,
  g: BubbleGeometry,
  normal: BubbleOutline,
): BubbleOutline {
  return { ...normal, body: mood === 'cold' ? coldBody(g) : weakBody(g) }
}

/** mood の本体の輪郭が、楕円から外へ出る最大の長さ。min(rx, ry) に対する比率 */
export const moodReach = (mood: BubbleMood): number => (mood === 'cold' ? COLD_POINT : 0)

/**
 * mood の本体の輪郭が、楕円から内へ入る最大の深さ。min(rx, ry) に対する比率。
 * cold の辺は外へ出た角へ向かうので、谷の頂点より内へは入らない
 */
export const moodInset = (mood: BubbleMood): number =>
  mood === 'cold' ? COLD_NOTCH : WEAK_DENT_MAX

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { bubbleNeck, bubbleOutline, bubbleTextBox } = await import('./bubble-outline')
  const { bubbleFits } = await import('./bubble-fit')
  const { containsPoint } = await import('./geometry')
  const { pathPoints } = await import('./bubble-path')

  const g = { cx: 100, cy: 100, rx: 60, ry: 40, tails: [{ x: 100, y: 190 }] }
  const tall = { cx: 0, cy: 0, rx: 10, ry: 40 }
  /** 楕円で正規化した中心からの距離。楕円の上で 1 */
  const radius = (geo: BubbleGeometry) => (p: { x: number; y: number }) =>
    Math.hypot((p.x - geo.cx) / geo.rx, (p.y - geo.cy) / geo.ry)
  const MOOD_LIST = ['cold', 'weak'] as const

  test('only cold and weak are moods', () => {
    expect(MOOD_LIST.every(isBubbleMood)).toBe(true)
    expect(isBubbleMood('normal')).toBe(false)
    expect(isBubbleMood('shout')).toBe(false)
  })

  test('a mood keeps the tails, fill and line of the normal bubble', () => {
    const two = {
      ...g,
      tails: [
        { x: 100, y: 190 },
        { x: 10, y: 20 },
      ],
    }
    const normal = bubbleOutline('normal', two)
    for (const mood of MOOD_LIST) {
      const o = bubbleOutline(mood, two)
      expect(o.tails).toEqual(normal.tails)
      expect(o.tails).toHaveLength(2)
      expect({ ink: o.ink, fill: o.fill, line: o.line }).toEqual({
        ink: [],
        fill: true,
        line: 'solid',
      })
    }
  })

  test('the body is one closed polygon that holds the centre', () => {
    for (const mood of MOOD_LIST) {
      for (const geo of [g, tall]) {
        const body = bubbleOutline(mood, geo).body
        expect(body[0]?.op).toBe('M')
        expect(body.at(-1)?.op).toBe('Z')
        expect(body.slice(1, -1).every((c) => c.op === 'L')).toBe(true)
        expect(containsPoint(pathPoints(body), { x: geo.cx, y: geo.cy })).toBe(true)
      }
    }
  })

  test('a joined mood bubble hides both ends of the neck under its body', () => {
    const other = { cx: 220, cy: 110, rx: 50, ry: 30 }
    for (const mood of MOOD_LIST) {
      const neck = pathPoints(bubbleNeck(g, other))
      const body = pathPoints(bubbleOutline(mood, g).body)
      const inside = neck.filter((p) => containsPoint(body, p))
      // 首の 4 隅のうち、こちらの中心側の 2 つ
      expect(inside).toHaveLength(2)
    }
  })

  describe('cold', () => {
    test('alternates corners pushed out of the ellipse with shallow notches', () => {
      const r = pathPoints(bubbleOutline('cold', g).body).map(radius(g))
      expect(r.length % 2).toBe(0)
      const corners = r.filter((_, i) => i % 2 === 0)
      const notches = r.filter((_, i) => i % 2 === 1)
      for (const c of corners) expect(c).toBeGreaterThan(1)
      for (const n of notches) expect(n).toBeLessThanOrEqual(1 + 1e-9)
      // 角の出方が揃っていない
      expect(Math.max(...corners) - Math.min(...corners)).toBeGreaterThan(0.01)
    })

    test('stays within its reach outside and its inset inside the ellipse', () => {
      for (const geo of [g, tall]) {
        for (const r of pathPoints(bubbleOutline('cold', geo).body).map(radius(geo))) {
          expect(r).toBeLessThanOrEqual(1 + moodReach('cold') + 1e-9)
          expect(r).toBeGreaterThanOrEqual(1 - moodInset('cold') - 1e-9)
        }
      }
    })

    test('a longer bubble gets more corners rather than longer edges', () => {
      const count = (geo: BubbleGeometry) => pathPoints(bubbleOutline('cold', geo).body).length
      expect(count(tall)).toBeGreaterThan(count({ cx: 0, cy: 0, rx: 10, ry: 10 }))
      expect(count({ ...g, rx: 120, ry: 80 })).toBe(count(g))
    })
  })

  describe('weak', () => {
    test('never goes outside the ellipse', () => {
      for (const geo of [g, tall]) {
        for (const r of pathPoints(bubbleOutline('weak', geo).body).map(radius(geo))) {
          expect(r).toBeLessThanOrEqual(1 + 1e-9)
          expect(r).toBeGreaterThanOrEqual(1 - moodInset('weak') - 1e-9)
        }
      }
    })

    test('is dented here and there, and keeps the ellipse between the dents', () => {
      const r = pathPoints(bubbleOutline('weak', g).body).map(radius(g))
      expect(Math.min(...r)).toBeLessThan(0.975)
      const onEllipse = r.filter((x) => Math.abs(x - 1) < 1e-9).length
      expect(onEllipse).toBeGreaterThan(r.length / 4)
      expect(onEllipse).toBeLessThan(r.length)
    })
  })

  test('the text box shrinks by how far the outline comes inside, and stays centred', () => {
    const normal = bubbleTextBox('normal', g)
    for (const mood of MOOD_LIST) {
      const box = bubbleTextBox(mood, g)
      expect(box.w).toBeLessThan(normal.w)
      expect(box.h).toBeLessThan(normal.h)
      expect(box.x + box.w / 2).toBeCloseTo(100)
      expect(box.y + box.h / 2).toBeCloseTo(100)
    }
    // 内へ 40 * 0.05 = 2 入るので、半径 58, 38 に普通の比率を掛ける
    expect(bubbleTextBox('cold', g)).toEqual({
      x: 100 - 58 * 0.7,
      y: 100 - 38 * 0.75,
      w: 58 * 2 * 0.7,
      h: 38 * 2 * 0.75,
    })
  })

  test('fitting leaves room for the corners of cold, and weak fits where normal does', () => {
    const frame = { panel: { rect: { x: 0, y: 0, w: 1, h: 1 } }, pageSize: { w: 100, h: 100 } }
    const near: Bubble = {
      id: 'b',
      order: 1,
      text: '',
      shape: 'normal',
      pos: { x: 0.5, y: 0.875 },
      size: { w: 0.4, h: 0.2 },
    }
    // 下端まで 12.5mm。半径 10mm と間 2mm で普通の形は収まり、cold は角が 1.2mm 出て収まらない
    expect(bubbleFits(near, frame)).toBe(true)
    expect(bubbleFits({ ...near, shape: 'weak' }, frame)).toBe(true)
    expect(bubbleFits({ ...near, shape: 'cold' }, frame)).toBe(false)
  })
}
