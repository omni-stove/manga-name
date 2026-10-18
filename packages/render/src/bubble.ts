import type { Bubble } from '@manga/schema'
import { type PxRect, pointToPx, sizeToPx } from './geometry'

/** px 単位のフキダシ。rx, ry は半径 */
interface Geometry {
  cx: number
  cy: number
  rx: number
  ry: number
  tail?: { x: number; y: number }
}

type Shape = Bubble['shape']
type Ctx = CanvasRenderingContext2D

const SHOUT_SPIKES = 14
const SHOUT_INNER = 0.78
const THOUGHT_BUMPS = 12
const THOUGHT_BULGE = 1.25
/** しっぽの付け根の開き（ラジアン）と、輪郭の内側に入れる比率 */
const TAIL_SPREAD = 0.35
const TAIL_BASE = 0.9

/** コマ内座標の Bubble を px にする */
export function bubbleGeometry(bubble: Bubble, panel: PxRect): Geometry {
  const { x: cx, y: cy } = pointToPx(bubble.pos, panel)
  const { w, h } = sizeToPx(bubble.size, panel)
  return {
    cx,
    cy,
    rx: w / 2,
    ry: h / 2,
    tail: bubble.tail && pointToPx(bubble.tail, panel),
  }
}

/** セリフを置く箱。輪郭の内側に収まるよう shape ごとに縮める */
export function textBox(shape: Shape, g: Geometry): PxRect {
  const f = shape === 'narration' ? { w: 0.85, h: 0.85 } : { w: 0.7, h: 0.75 }
  const w = g.rx * 2 * f.w
  const h = g.ry * 2 * f.h
  return { x: g.cx - w / 2, y: g.cy - h / 2, w, h }
}

/**
 * セリフの箱を、フキダシを切るコマの矩形 clip の内側に寄せる。見切れたフキダシでも
 * 見えている部分にセリフを置き、狭くなった分は割り付けが文字を小さくする。重ならなければ box をそのまま返す
 */
export function clipTextBox(box: PxRect, clip: PxRect): PxRect {
  const x = Math.max(box.x, clip.x)
  const y = Math.max(box.y, clip.y)
  const w = Math.min(box.x + box.w, clip.x + clip.w) - x
  const h = Math.min(box.y + box.h, clip.y + clip.h) - y
  return w > 0 && h > 0 ? { x, y, w, h } : box
}

function pointAt(g: Geometry, angle: number, scale: number): { x: number; y: number } {
  return { x: g.cx + g.rx * scale * Math.cos(angle), y: g.cy + g.ry * scale * Math.sin(angle) }
}

/** 輪郭のサブパスを現在のパスに足す。beginPath は呼ばない */
function traceBody(ctx: Ctx, shape: Shape, g: Geometry): void {
  switch (shape) {
    case 'normal': {
      ctx.moveTo(g.cx + g.rx, g.cy)
      ctx.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, Math.PI * 2)
      ctx.closePath()
      return
    }
    case 'shout': {
      for (let i = 0; i < SHOUT_SPIKES * 2; i++) {
        const p = pointAt(g, (i * Math.PI) / SHOUT_SPIKES, i % 2 === 0 ? 1 : SHOUT_INNER)
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.closePath()
      return
    }
    case 'thought': {
      const step = (Math.PI * 2) / THOUGHT_BUMPS
      const start = pointAt(g, 0, 1)
      ctx.moveTo(start.x, start.y)
      for (let i = 0; i < THOUGHT_BUMPS; i++) {
        const control = pointAt(g, (i + 0.5) * step, THOUGHT_BULGE)
        const end = pointAt(g, (i + 1) * step, 1)
        ctx.quadraticCurveTo(control.x, control.y, end.x, end.y)
      }
      ctx.closePath()
      return
    }
    case 'narration': {
      const r = Math.min(g.rx, g.ry) * 0.25
      const x0 = g.cx - g.rx
      const y0 = g.cy - g.ry
      const x1 = g.cx + g.rx
      const y1 = g.cy + g.ry
      ctx.moveTo(x0 + r, y0)
      ctx.arcTo(x1, y0, x1, y1, r)
      ctx.arcTo(x1, y1, x0, y1, r)
      ctx.arcTo(x0, y1, x0, y0, r)
      ctx.arcTo(x0, y0, x1, y0, r)
      ctx.closePath()
      return
    }
  }
}

/** 三角のしっぽの 3 点。付け根は輪郭の少し内側に置き、本体の塗りと重ねる */
function tailTriangle(g: Geometry, tail: { x: number; y: number }) {
  const angle = Math.atan2((tail.y - g.cy) / g.ry, (tail.x - g.cx) / g.rx)
  return {
    a: pointAt(g, angle - TAIL_SPREAD, TAIL_BASE),
    b: pointAt(g, angle + TAIL_SPREAD, TAIL_BASE),
    tip: tail,
  }
}

/** 思考のしっぽは本体から先端へ小さくなる 2 つの円 */
function thoughtTailCircles(g: Geometry, tail: { x: number; y: number }) {
  const angle = Math.atan2((tail.y - g.cy) / g.ry, (tail.x - g.cx) / g.rx)
  const edge = pointAt(g, angle, 1)
  const unit = Math.min(g.rx, g.ry)
  return [
    { t: 0.3, r: unit * 0.18 },
    { t: 0.75, r: unit * 0.11 },
  ].map(({ t, r }) => ({
    x: edge.x + (tail.x - edge.x) * t,
    y: edge.y + (tail.y - edge.y) * t,
    r,
  }))
}

/** 本体としっぽの領域を color で塗る。配置図はこれだけを使う */
export function fillBubble(ctx: Ctx, shape: Shape, g: Geometry, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  traceBody(ctx, shape, g)
  ctx.fill()
  if (!g.tail) return
  ctx.beginPath()
  if (shape === 'thought') {
    for (const c of thoughtTailCircles(g, g.tail)) {
      ctx.moveTo(c.x + c.r, c.y)
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
    }
  } else {
    const { a, b, tip } = tailTriangle(g, g.tail)
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(tip.x, tip.y)
    ctx.lineTo(b.x, b.y)
    ctx.closePath()
  }
  ctx.fill()
}

/** 本体としっぽを囲む矩形。クリップ用 */
function bounds(g: Geometry, margin: number): PxRect {
  const xs = [g.cx - g.rx * THOUGHT_BULGE, g.cx + g.rx * THOUGHT_BULGE]
  const ys = [g.cy - g.ry * THOUGHT_BULGE, g.cy + g.ry * THOUGHT_BULGE]
  if (g.tail) {
    xs.push(g.tail.x)
    ys.push(g.tail.y)
  }
  const x = Math.min(...xs) - margin
  const y = Math.min(...ys) - margin
  return { x, y, w: Math.max(...xs) + margin - x, h: Math.max(...ys) + margin - y }
}

/** 白塗り黒線のフキダシ。しっぽがあれば本体と繋げて描く */
export function drawBubble(ctx: Ctx, shape: Shape, g: Geometry, lineWidth: number): void {
  ctx.save()
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = '#000'
  ctx.lineJoin = 'round'
  fillBubble(ctx, shape, g, '#fff')

  if (!g.tail) {
    ctx.beginPath()
    traceBody(ctx, shape, g)
    ctx.stroke()
    ctx.restore()
    return
  }

  if (shape === 'thought') {
    ctx.beginPath()
    traceBody(ctx, shape, g)
    ctx.stroke()
    for (const c of thoughtTailCircles(g, g.tail)) {
      ctx.beginPath()
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
    return
  }

  const { a, b, tip } = tailTriangle(g, g.tail)
  const box = bounds(g, lineWidth * 4)

  ctx.save()
  ctx.beginPath()
  ctx.rect(box.x, box.y, box.w, box.h)
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(b.x, b.y)
  ctx.closePath()
  ctx.clip('evenodd')
  ctx.beginPath()
  traceBody(ctx, shape, g)
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(box.x, box.y, box.w, box.h)
  traceBody(ctx, shape, g)
  ctx.clip('evenodd')
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
  ctx.restore()

  ctx.restore()
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { getBackend } = await import('./backend')

  const GREY = [128, 128, 128]

  /** 灰色で塗った 200 x 200 の面に draw で描き、画素を RGB で読む関数を返す */
  const paint = async (draw: (ctx: Ctx) => void) => {
    const surface = (await getBackend()).createSurface(200, 200)
    surface.ctx.fillStyle = 'rgb(128, 128, 128)'
    surface.ctx.fillRect(0, 0, 200, 200)
    draw(surface.ctx)
    return (x: number, y: number) =>
      Array.from(surface.ctx.getImageData(x, y, 1, 1).data.subarray(0, 3))
  }
  const dark = (rgb: number[]) => rgb.every((c) => c < 100)

  const body = { cx: 100, cy: 100, rx: 60, ry: 40 }
  const tailed = { ...body, tail: { x: 100, y: 190 } }

  test('bubbleGeometry maps pos, size and tail into the panel in px', () => {
    const bubble: Bubble = {
      id: 'bb',
      order: 1,
      text: '',
      shape: 'normal',
      pos: { x: 0.5, y: 0.25 },
      size: { w: 0.2, h: 0.4 },
      tail: { x: 0, y: 1 },
    }
    const panel = { x: 100, y: 0, w: 200, h: 100 }
    expect(bubbleGeometry(bubble, panel)).toEqual({
      cx: 200,
      cy: 25,
      rx: 20,
      ry: 20,
      tail: { x: 100, y: 100 },
    })
    expect(bubbleGeometry({ ...bubble, tail: undefined }, panel).tail).toBeUndefined()
  })

  test('textBox is centred, and narration keeps more of the body than other shapes', () => {
    expect(textBox('narration', body)).toEqual({ x: 49, y: 66, w: 102, h: 68 })
    for (const shape of ['normal', 'shout', 'thought'] as const) {
      expect(textBox(shape, body)).toEqual({ x: 58, y: 70, w: 84, h: 60 })
    }
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

  describe('drawBubble', () => {
    test('a normal bubble is white inside a black outline, and leaves the outside alone', async () => {
      const at = await paint((ctx) => drawBubble(ctx, 'normal', body, 4))
      expect(at(100, 100)).toEqual([255, 255, 255])
      expect(dark(at(160, 100))).toBe(true)
      expect(dark(at(100, 60))).toBe(true)
      expect(at(190, 100)).toEqual(GREY)
      expect(at(158, 136)).toEqual(GREY)
    })

    test('a tail joins the body without an outline across its base', async () => {
      const at = await paint((ctx) => drawBubble(ctx, 'normal', tailed, 4))
      expect(at(100, 160)).toEqual([255, 255, 255])
      expect(at(100, 140)).toEqual([255, 255, 255])
      // しっぽの辺は引く。付け根は (81.5, 133.8) と (118.5, 133.8) あたり
      expect(dark(at(109, 162))).toBe(true)
      expect(dark(at(91, 162))).toBe(true)
      expect(dark(at(100, 60))).toBe(true)
      expect(at(130, 170)).toEqual(GREY)
    })

    test('a shout bubble is spiky: the gaps between spikes stay outside', async () => {
      const at = await paint((ctx) => drawBubble(ctx, 'shout', body, 2))
      const point = (angle: number, scale: number) =>
        at(
          Math.round(100 + 60 * scale * Math.cos(angle)),
          Math.round(100 + 40 * scale * Math.sin(angle)),
        )
      expect(point(0, 0.9)).toEqual([255, 255, 255])
      expect(point(Math.PI / 14, 0.95)).toEqual(GREY)
    })

    test('a thought tail is two separate circles shrinking toward the tip', async () => {
      const at = await paint((ctx) => drawBubble(ctx, 'thought', tailed, 1))
      // 本体の縁 (100, 140) から先端 (100, 190) へ 0.3 と 0.75 の位置
      expect(at(100, 155)).toEqual([255, 255, 255])
      expect(at(100, 177)).toEqual([255, 255, 255])
      expect(at(100, 167)).toEqual(GREY)
      expect(at(100, 186)).toEqual(GREY)
    })
  })

  test('fillBubble fills body and tail with the colour and draws no outline', async () => {
    const at = await paint((ctx) => fillBubble(ctx, 'narration', tailed, 'rgb(255, 0, 0)'))
    expect(at(100, 100)).toEqual([255, 0, 0])
    // 角丸の矩形なので、楕円なら外になる隅の近くも塗る
    expect(at(150, 135)).toEqual([255, 0, 0])
    expect(at(100, 170)).toEqual([255, 0, 0])
    expect(at(100, 195)).toEqual(GREY)
    expect(at(170, 100)).toEqual(GREY)
  })
}
