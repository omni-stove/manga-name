import { clipHalfPlane, containsPoint, convexHull, panelOutline } from './geometry'
import type { Bubble, Panel, Point, Size } from './project'

/** 枠の線からフキダシの本体までに空ける間（mm） */
const FRAME_MARGIN_MM = 2
// bubbleFits は 0.001 単位に丸めた後の値を見るので、丸めで出る僅かなはみ出しは許す
const FIT_SLACK_MM = 0.1
// thought の輪郭は膨らみの頂点で楕円の約 1.11 倍まで出る（render の THOUGHT_BULGE 1.25 の二次ベジェの頂点）
const THOUGHT_REACH = 1.11
const SHRINK_STEPS = 20

const round = (v: number) => Math.round(v * 1000) / 1000

type Shape = Bubble['shape']

/** フキダシを収めるコマ。pageSize はページの大きさ（mm） */
export interface BubbleFrame {
  panel: Pick<Panel, 'rect' | 'shape'>
  pageSize: Pick<Size, 'w' | 'h'>
}

interface FrameMm {
  outline: Point[]
  box: { x: number; y: number; w: number; h: number }
}

function frameMm({ panel, pageSize }: BubbleFrame): FrameMm {
  const { x, y, w, h } = panel.rect
  return {
    // 中心の動ける範囲を半平面の積で出すので凸でなければならない。凹んだ輪郭は凸包で近似する
    outline: convexHull(
      panelOutline(panel).map((p) => ({ x: p.x * pageSize.w, y: p.y * pageSize.h })),
    ),
    box: { x: x * pageSize.w, y: y * pageSize.h, w: w * pageSize.w, h: h * pageSize.h },
  }
}

/** 半径 rx, ry の本体が、中心から単位ベクトル n の向きへどこまで出るか */
function reach(shape: Shape, rx: number, ry: number, n: Point): number {
  if (shape === 'narration') return Math.abs(n.x) * rx + Math.abs(n.y) * ry
  return (shape === 'thought' ? THOUGHT_REACH : 1) * Math.hypot(n.x * rx, n.y * ry)
}

/** 半径 rx, ry の本体を枠から margin 内側に収められる中心の範囲。無ければ空 */
function centerRegion(frame: FrameMm, shape: Shape, rx: number, ry: number, margin: number) {
  const { outline } = frame
  let region: Point[] = outline
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length] as Point
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len === 0) return
    const inward = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
    region = clipHalfPlane(region, a, b, margin + reach(shape, rx, ry, inward))
  })
  return region
}

/** 凸多角形の中で p に最も近い点 */
function nearestIn(poly: readonly Point[], p: Point): Point {
  if (containsPoint(poly, p)) return p
  let best = p
  let bestD = Number.POSITIVE_INFINITY
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length] as Point
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t =
      len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    const q = { x: a.x + dx * t, y: a.y + dy * t }
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d < bestD) {
      best = q
      bestD = d
    }
  })
  return best
}

const radii = (bubble: Bubble, f: FrameMm) => ({
  rx: (bubble.size.w * f.box.w) / 2,
  ry: (bubble.size.h * f.box.h) / 2,
})

/** フキダシの本体（しっぽは除く）が、コマの輪郭から FRAME_MARGIN_MM 内側に収まっているか */
export function bubbleFits(bubble: Bubble, frame: BubbleFrame): boolean {
  const f = frameMm(frame)
  const { rx, ry } = radii(bubble, f)
  const region = centerRegion(f, bubble.shape, rx, ry, FRAME_MARGIN_MM - FIT_SLACK_MM)
  const c = { x: f.box.x + bubble.pos.x * f.box.w, y: f.box.y + bubble.pos.y * f.box.h }
  return region.length > 0 && containsPoint(region, c)
}

/**
 * フキダシの本体を、コマの輪郭から FRAME_MARGIN_MM 内側に収めた姿。中心は収まる範囲で元に最も近い所へ
 * 動かし、その大きさでは収まらなければ縦横比を保って縮める。値は 0.001 単位に丸め、しっぽはそのまま。
 * コマが小さすぎてどう縮めても収まらないか、コマの幅か高さが 0 なら元のまま返す
 */
export function fitBubble(bubble: Bubble, frame: BubbleFrame): Bubble {
  const f = frameMm(frame)
  if (!(f.box.w > 0 && f.box.h > 0)) return bubble
  const { rx, ry } = radii(bubble, f)
  const regionAt = (s: number) => centerRegion(f, bubble.shape, rx * s, ry * s, FRAME_MARGIN_MM)
  let scale = 1
  let region = regionAt(1)
  if (region.length === 0) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < SHRINK_STEPS; i++) {
      const mid = (lo + hi) / 2
      if (regionAt(mid).length > 0) lo = mid
      else hi = mid
    }
    if (lo === 0) return bubble
    scale = lo
    region = regionAt(lo)
  }
  const c = nearestIn(region, {
    x: f.box.x + bubble.pos.x * f.box.w,
    y: f.box.y + bubble.pos.y * f.box.h,
  })
  return {
    ...bubble,
    pos: { x: round((c.x - f.box.x) / f.box.w), y: round((c.y - f.box.y) / f.box.h) },
    size: { w: round(bubble.size.w * scale), h: round(bubble.size.h * scale) },
  }
}

/** コマのフキダシのうち overflow でないものを fitBubble で枠に収めたコマ。どれも動かなければ panel そのもの */
export function fitPanelBubbles<P extends BubbleFrame['panel'] & { bubbles: Bubble[] }>(
  panel: P,
  pageSize: BubbleFrame['pageSize'],
): P {
  const bubbles = panel.bubbles.map((b) => (b.overflow ? b : fitBubble(b, { panel, pageSize })))
  const changed = bubbles.some((b, i) => JSON.stringify(b) !== JSON.stringify(panel.bubbles[i]))
  return changed ? { ...panel, bubbles } : panel
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const pageSize = { w: 100, h: 100 }
  const square: BubbleFrame = { panel: { rect: { x: 0, y: 0, w: 1, h: 1 } }, pageSize }
  const bubble: Bubble = {
    id: 'b',
    order: 1,
    text: '',
    shape: 'normal',
    pos: { x: 0.5, y: 0.5 },
    size: { w: 0.4, h: 0.2 },
  }

  test('a bubble inside the frame stays as it is', () => {
    expect(bubbleFits(bubble, square)).toBe(true)
    expect(fitBubble(bubble, square)).toEqual(bubble)
  })

  test('a bubble crossing an edge moves back inside by the margin', () => {
    const out = { ...bubble, pos: { x: 0.9, y: 0.5 } }
    expect(bubbleFits(out, square)).toBe(false)
    const fitted = fitBubble(out, square)
    // 半径 20mm と間 2mm で、中心は右端から 22mm
    expect(fitted.pos.x).toBeCloseTo(0.78)
    expect(fitted.pos.y).toBeCloseTo(0.5)
    expect(fitted.size).toEqual(bubble.size)
    expect(bubbleFits(fitted, square)).toBe(true)
  })

  test('fitPanelBubbles fits every bubble but the overflow ones', () => {
    const out = { ...bubble, pos: { x: 0.9, y: 0.5 } }
    const panel = { rect: square.panel.rect, bubbles: [out, { ...out, id: 'c', overflow: true }] }
    const fitted = fitPanelBubbles(panel, pageSize)
    expect(fitted.bubbles[0]?.pos.x).toBeCloseTo(0.78)
    expect(fitted.bubbles[1]).toBe(panel.bubbles[1])
    expect(fitPanelBubbles({ ...panel, bubbles: [bubble] }, pageSize).bubbles[0]).toBe(bubble)
  })

  test('a bubble too large for the frame shrinks with its aspect ratio', () => {
    const fitted = fitBubble({ ...bubble, size: { w: 1, h: 0.5 } }, square)
    expect(fitted.size.w).toBeCloseTo(0.96, 3)
    expect(fitted.size.w / fitted.size.h).toBeCloseTo(2)
    expect(bubbleFits(fitted, square)).toBe(true)
  })

  test('a slanted panel keeps the bubble off the diagonal edge', () => {
    const tri: BubbleFrame = {
      panel: {
        rect: { x: 0, y: 0, w: 1, h: 1 },
        shape: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      },
      pageSize,
    }
    const fitted = fitBubble({ ...bubble, size: { w: 0.2, h: 0.2 } }, tri)
    expect(fitted.pos.x + fitted.pos.y).toBeLessThan(1)
    expect(bubbleFits(fitted, tri)).toBe(true)
  })

  test('thought reaches further than normal, and narration further toward a diagonal', () => {
    const near = { ...bubble, pos: { x: 0.5, y: 0.875 } }
    expect(bubbleFits(near, square)).toBe(true)
    expect(bubbleFits({ ...near, shape: 'thought' }, square)).toBe(false)
    const tri: BubbleFrame = {
      panel: {
        rect: { x: 0, y: 0, w: 1, h: 1 },
        shape: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      },
      pageSize,
    }
    // 斜辺まで 14.1mm。円は 10mm、四角は角が 14.1mm 出る
    const centred = { ...bubble, size: { w: 0.2, h: 0.2 }, pos: { x: 0.4, y: 0.4 } }
    expect(bubbleFits(centred, tri)).toBe(true)
    expect(bubbleFits({ ...centred, shape: 'narration' }, tri)).toBe(false)
  })
}
