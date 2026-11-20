import { bubbleReach, bubbleTextBox } from './bubble-outline'
import { clipHalfPlane, containsPoint, convexHull, panelOutline } from './geometry'
import type { Bubble, Panel, Point, Rect, Size } from './project'
import { parseRuby, stripRuby } from './ruby'
import { combineUpright } from './tate-chu-yoko'

/** 枠の線からフキダシの本体までに空ける間（mm） */
const FRAME_MARGIN_MM = 2
// bubbleFits は 0.001 単位に丸めた後の値を見るので、丸めで出る僅かなはみ出しは許す
const FIT_SLACK_MM = 0.1
const SHRINK_STEPS = 20

const round = (v: number) => Math.round(v * 1000) / 1000

type Shape = Bubble['shape']

/** 文字数から大きさを決めるときの字の大きさ。見開きでも変わらないようページの高さに対する比率で持ち、B5 で 14 級ほど */
const SPEECH_FONT = 0.0135
/** 1 行に入れる字数の上限。縦書きは漫画のセリフの 1 行の長さ、横書きは半角を 0.5 字に数える */
const LINE_CHARS = { vertical: 8, horizontal: 12 }
/** 行どうしの送り。字の大きさに対する比率で、描画の行送りと同じ */
const LINE_PITCH = 1.2
/** ルビのある行の太さに足す分。字の大きさに対する比率 */
const RUBY_SCALE = 0.5
/**
 * 字の組の周りに空ける余白。字の大きさに対する比率で、両側の合計。行を送る向きを厚くしないと、
 * 1 行や 2 行のフキダシが字に貼りついた細い棒になる
 */
const TEXT_PADDING = { along: 1, across: 1.8 }
/** セリフの無いフキダシを、この字数のセリフとして大きさを決める */
const BLANK_CHARS = 12
const HALF_WIDTH = /^[\x20-\x7e｡-ﾟ]$/

/**
 * フキダシを収めるコマ。pageSize はページの大きさ（mm）。bounds（ページの正規化座標）を渡すと、
 * コマのうちその内側だけに収める。内枠の外にはみ出たセリフは描画で内枠に寄せて詰められるため
 */
export interface BubbleFrame {
  panel: Pick<Panel, 'rect' | 'shape'>
  pageSize: Pick<Size, 'w' | 'h'>
  bounds?: Rect
}

interface FrameMm {
  outline: Point[]
  box: { x: number; y: number; w: number; h: number }
}

function frameMm({ panel, pageSize, bounds }: BubbleFrame): FrameMm {
  const { x, y, w, h } = panel.rect
  const mm = (p: Point) => ({ x: p.x * pageSize.w, y: p.y * pageSize.h })
  // 中心の動ける範囲を半平面の積で出すので凸でなければならない。凹んだ輪郭は凸包で近似する
  const outline = convexHull(panelOutline(panel).map(mm))
  return {
    outline: bounds ? clipTo(outline, bounds, mm) : outline,
    box: { x: x * pageSize.w, y: y * pageSize.h, w: w * pageSize.w, h: h * pageSize.h },
  }
}

/** 凸の outline のうち bounds の内側。重ならなければ outline のまま */
function clipTo(outline: Point[], bounds: Rect, mm: (p: Point) => Point): Point[] {
  const { x, y, w, h } = bounds
  // 凸包と同じ巡りにして、clipHalfPlane の内側の向きを outline とそろえる
  const rect = convexHull(
    [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ].map(mm),
  )
  let clipped = outline
  rect.forEach((a, i) => {
    clipped = clipHalfPlane(clipped, a, rect[(i + 1) % rect.length] as Point, 0)
  })
  return clipped.length > 0 ? clipped : outline
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
    region = clipHalfPlane(region, a, b, margin + bubbleReach(shape, rx, ry, inward))
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

/**
 * セリフを標準の字の大きさで組んだときに、それを囲むフキダシの大きさ（コマ内座標）。
 * コマの縦横比に引きずられず、セリフの行数と 1 行の長さで縦長にも横長にもなる。行は段落ごとに
 * LINE_CHARS 字までで均等に折り返し、それでは行の向きにコマへ収まらなければ 1 行を短くして行を増やす。
 * 行を送る向きに収まるかは見ないので、置いた後に fitBubble で収める
 */
export function textBubbleSize(
  bubble: Pick<Bubble, 'text' | 'shape' | 'writing'>,
  frame: BubbleFrame,
): Bubble['size'] {
  const horizontal = bubble.writing === 'horizontal'
  const text = bubble.text.trim() === '' ? '　'.repeat(BLANK_CHARS) : bubble.text
  const lengths = stripRuby(text)
    .split('\n')
    .map((paragraph) =>
      horizontal
        ? Array.from(paragraph).reduce((sum, g) => sum + (HALF_WIDTH.test(g) ? 0.5 : 1), 0)
        : combineUpright(Array.from(paragraph)).length,
    )
  const font = frame.pageSize.h * SPEECH_FONT
  const thickness = parseRuby(text).some((s) => s.ruby !== undefined || s.emphasis)
    ? 1 + RUBY_SCALE
    : 1
  // 本体の半径とセリフの箱は比例するので、半径 1 の箱の大きさで割って直径に戻す
  const unit = bubbleTextBox(bubble.shape, { cx: 0, cy: 0, rx: 1, ry: 1 })
  const diameter = (limit: number) => {
    let lines = 0
    let longest = 0
    for (const length of lengths) {
      const count = Math.max(1, Math.ceil(length / limit))
      lines += count
      longest = Math.max(longest, length / count)
    }
    const along = font * (Math.max(2, Math.ceil(longest)) + TEXT_PADDING.along)
    const across =
      font * (lines * thickness + (lines - 1) * (LINE_PITCH - 1) + TEXT_PADDING.across)
    const block = horizontal ? { w: along, h: across } : { w: across, h: along }
    return { w: (block.w / unit.w) * 2, h: (block.h / unit.h) * 2 }
  }
  const f = frameMm(frame)
  const room = Math.max(...f.outline.map((p) => p[horizontal ? 'x' : 'y'])) -
    Math.min(...f.outline.map((p) => p[horizontal ? 'x' : 'y'])) -
    FRAME_MARGIN_MM * 2
  let limit = horizontal ? LINE_CHARS.horizontal : LINE_CHARS.vertical
  while (limit > 2 && diameter(limit)[horizontal ? 'w' : 'h'] > room) limit--
  const d = diameter(limit)
  return { w: round(d.w / (f.box.w || 1)), h: round(d.h / (f.box.h || 1)) }
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

  test('a wide horizontal bubble fits and shrinks by its outline, and keeps its writing', () => {
    const wide: Bubble = { ...bubble, writing: 'horizontal', size: { w: 0.6, h: 0.15 } }
    expect(bubbleFits(wide, square)).toBe(true)
    const out = { ...wide, pos: { x: 0.9, y: 0.5 } }
    const moved = fitBubble(out, square)
    // 半径 30mm と間 2mm で、中心は右端から 32mm
    expect(moved.pos.x).toBeCloseTo(0.68)
    expect(moved).toMatchObject({ writing: 'horizontal', size: wide.size })
    const shrunk = fitBubble({ ...wide, size: { w: 1.2, h: 0.3 } }, square)
    expect(shrunk.size.w / shrunk.size.h).toBeCloseTo(4, 1)
    expect(shrunk.writing).toBe('horizontal')
    expect(bubbleFits(shrunk, square)).toBe(true)
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

  test('textBubbleSize follows the lines, not the panel', () => {
    const wide: BubbleFrame = { panel: { rect: { x: 0, y: 0, w: 1, h: 0.5 } }, pageSize }
    const mm = (text: string, writing?: Bubble['writing'], frame = square) => {
      const s = textBubbleSize({ text, shape: 'normal', writing }, frame)
      return { w: s.w * frame.panel.rect.w * 100, h: s.h * frame.panel.rect.h * 100 }
    }
    // 縦書きの短いセリフは縦長、横書きなら横長で、コマが横長でも変わらない
    const short = mm('なんだって')
    expect(short.h).toBeGreaterThan(short.w * 1.3)
    expect(mm('なんだって', undefined, wide).w).toBeCloseTo(short.w, 1)
    expect(mm('なんだって', undefined, wide).h).toBeCloseTo(short.h, 1)
    const across = mm('なんだって', 'horizontal')
    expect(across.w).toBeGreaterThan(across.h * 1.3)
    // 長いセリフは行が増えて太り、1 行の長さは上限で止まる
    const long = mm('そんなことを言われても今さらどうにもならないよ')
    expect(long.w).toBeGreaterThan(short.w * 1.5)
    expect(long.h).toBeLessThan(short.h * 2)
    // 改行は行を分け、ルビは行を太らせる
    expect(mm('なんだ\nって').w).toBeGreaterThan(short.w)
    expect(mm('|何《なん》だって').w).toBeGreaterThan(mm('何だって').w)
    // 行の向きにコマへ収まらなければ、1 行を短くして行を増やす
    const low: BubbleFrame = { panel: { rect: { x: 0, y: 0, w: 1, h: 0.1 } }, pageSize }
    const folded = mm('なんだって', undefined, low)
    expect(folded.h).toBeLessThanOrEqual(10 - 4)
    expect(folded.w).toBeGreaterThan(short.w)
  })

  test('bounds keeps the bubble inside both the panel and the bounds', () => {
    const bounded = { ...square, bounds: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }
    const corner = { ...bubble, pos: { x: 0.25, y: 0.15 } }
    expect(bubbleFits(corner, square)).toBe(true)
    expect(bubbleFits(corner, bounded)).toBe(false)
    const fitted = fitBubble(corner, bounded)
    // 半径 20mm と 10mm、間 2mm で、中心は左上の境から 22mm と 12mm
    expect(fitted.pos.x).toBeCloseTo(0.32)
    expect(fitted.pos.y).toBeCloseTo(0.22)
    // 境の外のコマは境を無視する
    const outside = { ...square, bounds: { x: 2, y: 2, w: 1, h: 1 } }
    expect(fitBubble(corner, outside)).toEqual(fitBubble(corner, square))
  })
}
