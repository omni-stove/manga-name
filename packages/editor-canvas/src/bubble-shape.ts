import type { Bubble } from '@manga/schema'

/** ページ座標（mm）のフキダシ。rx, ry は半径 */
interface BubbleGeometry {
  cx: number
  cy: number
  rx: number
  ry: number
  tail?: { x: number; y: number }
}

/** ページ座標（mm）の矩形 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

type Shape = Bubble['shape']

// 輪郭の比率は packages/render/src/bubble.ts と揃える。render は import できないので値を写している
const SHOUT_SPIKES = 14
const SHOUT_INNER = 0.78
const THOUGHT_BUMPS = 12
const THOUGHT_BULGE = 1.25
const TAIL_SPREAD = 0.35
const TAIL_BASE = 0.9

const fmt = (n: number) => Number(n.toFixed(3))

/** コマ内座標の Bubble を、コマのページ座標の矩形 panel に置く */
export function bubbleGeometry(bubble: Bubble, panel: Box): BubbleGeometry {
  return {
    cx: panel.x + bubble.pos.x * panel.w,
    cy: panel.y + bubble.pos.y * panel.h,
    rx: (bubble.size.w * panel.w) / 2,
    ry: (bubble.size.h * panel.h) / 2,
    tail: bubble.tail && {
      x: panel.x + bubble.tail.x * panel.w,
      y: panel.y + bubble.tail.y * panel.h,
    },
  }
}

/** セリフを置く箱。輪郭の内側に収まるよう shape ごとに縮める */
export function textBox(shape: Shape, g: BubbleGeometry): Box {
  const f = shape === 'narration' ? { w: 0.85, h: 0.85 } : { w: 0.7, h: 0.75 }
  const w = g.rx * 2 * f.w
  const h = g.ry * 2 * f.h
  return { x: g.cx - w / 2, y: g.cy - h / 2, w, h }
}

function pointAt(g: BubbleGeometry, angle: number, scale: number) {
  return { x: g.cx + g.rx * scale * Math.cos(angle), y: g.cy + g.ry * scale * Math.sin(angle) }
}

/** 本体の輪郭の SVG path */
export function bodyPath(shape: Shape, g: BubbleGeometry): string {
  switch (shape) {
    case 'normal': {
      const { cx, cy, rx, ry } = g
      return `M${fmt(cx - rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}Z`
    }
    case 'shout': {
      const points = Array.from({ length: SHOUT_SPIKES * 2 }, (_, i) =>
        pointAt(g, (i * Math.PI) / SHOUT_SPIKES, i % 2 === 0 ? 1 : SHOUT_INNER),
      )
      return `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join('')}Z`
    }
    case 'thought': {
      const step = (Math.PI * 2) / THOUGHT_BUMPS
      const start = pointAt(g, 0, 1)
      let d = `M${fmt(start.x)} ${fmt(start.y)}`
      for (let i = 0; i < THOUGHT_BUMPS; i++) {
        const c = pointAt(g, (i + 0.5) * step, THOUGHT_BULGE)
        const e = pointAt(g, (i + 1) * step, 1)
        d += `Q${fmt(c.x)} ${fmt(c.y)} ${fmt(e.x)} ${fmt(e.y)}`
      }
      return `${d}Z`
    }
    case 'narration': {
      const r = fmt(Math.min(g.rx, g.ry) * 0.25)
      const x0 = g.cx - g.rx
      const y0 = g.cy - g.ry
      const x1 = g.cx + g.rx
      const y1 = g.cy + g.ry
      return [
        `M${fmt(x0 + r)} ${fmt(y0)}`,
        `H${fmt(x1 - r)}A${r} ${r} 0 0 1 ${fmt(x1)} ${fmt(y0 + r)}`,
        `V${fmt(y1 - r)}A${r} ${r} 0 0 1 ${fmt(x1 - r)} ${fmt(y1)}`,
        `H${fmt(x0 + r)}A${r} ${r} 0 0 1 ${fmt(x0)} ${fmt(y1 - r)}`,
        `V${fmt(y0 + r)}A${r} ${r} 0 0 1 ${fmt(x0 + r)} ${fmt(y0)}Z`,
      ].join('')
    }
  }
}

/**
 * しっぽの SVG path。thought は先端へ小さくなる 2 つの円、それ以外は三角。
 * 三角の付け根は輪郭の少し内側に置き、本体の塗りで継ぎ目を隠す。tail が無ければ null
 */
export function tailPath(shape: Shape, g: BubbleGeometry): string | null {
  const tail = g.tail
  if (!tail) return null
  const angle = Math.atan2((tail.y - g.cy) / g.ry, (tail.x - g.cx) / g.rx)
  if (shape === 'thought') {
    const edge = pointAt(g, angle, 1)
    const unit = Math.min(g.rx, g.ry)
    return [
      { t: 0.3, r: unit * 0.18 },
      { t: 0.75, r: unit * 0.11 },
    ]
      .map(({ t, r }) => {
        const x = edge.x + (tail.x - edge.x) * t
        const y = edge.y + (tail.y - edge.y) * t
        return `M${fmt(x - r)} ${fmt(y)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(x + r)} ${fmt(y)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(x - r)} ${fmt(y)}Z`
      })
      .join('')
  }
  const a = pointAt(g, angle - TAIL_SPREAD, TAIL_BASE)
  const b = pointAt(g, angle + TAIL_SPREAD, TAIL_BASE)
  return `M${fmt(a.x)} ${fmt(a.y)}L${fmt(tail.x)} ${fmt(tail.y)}L${fmt(b.x)} ${fmt(b.y)}Z`
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  const bubble = (shape: Shape, tail?: { x: number; y: number }): Bubble => ({
    id: 'b',
    order: 1,
    text: '',
    shape,
    pos: { x: 0.5, y: 0.5 },
    size: { w: 0.4, h: 0.2 },
    tail,
  })
  const panel = { x: 10, y: 20, w: 100, h: 50 }

  test('bubbleGeometry places the bubble in page units', () => {
    expect(bubbleGeometry(bubble('normal', { x: 0, y: 1 }), panel)).toEqual({
      cx: 60,
      cy: 45,
      rx: 20,
      ry: 5,
      tail: { x: 10, y: 70 },
    })
  })

  test('bodyPath draws a closed outline for every shape', () => {
    const g = bubbleGeometry(bubble('normal'), panel)
    for (const shape of ['normal', 'shout', 'thought', 'narration'] as const) {
      expect(bodyPath(shape, g)).toMatch(/^M.*Z$/)
    }
    expect(bodyPath('shout', g).match(/L/g)).toHaveLength(SHOUT_SPIKES * 2 - 1)
    expect(bodyPath('thought', g).match(/Q/g)).toHaveLength(THOUGHT_BUMPS)
  })

  test('tailPath is a triangle to the tip, two circles for thought, null without a tail', () => {
    const g = bubbleGeometry(bubble('normal', { x: 0, y: 1 }), panel)
    expect(tailPath('normal', g)).toContain('L10 70')
    expect(tailPath('thought', g)?.match(/M/g)).toHaveLength(2)
    expect(tailPath('normal', bubbleGeometry(bubble('normal'), panel))).toBeNull()
  })
}
