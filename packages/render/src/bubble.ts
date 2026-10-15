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
