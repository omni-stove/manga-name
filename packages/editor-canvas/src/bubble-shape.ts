import {
  type Bubble,
  type BubbleGeometry,
  type BubbleOutline,
  bubbleOutline,
  type PathCommand,
} from '@manga/schema'

/** ページ座標（mm）の矩形 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

type Shape = Bubble['shape']

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

/** 描画命令を SVG path の d にする。命令が無ければ null */
function toPath(cmds: readonly PathCommand[]): string | null {
  if (cmds.length === 0) return null
  return cmds
    .map((c) => {
      if (c.op === 'Z') return 'Z'
      if (c.op === 'Q') return `Q${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x)} ${fmt(c.y)}`
      if (c.op === 'C') {
        return `C${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x2)} ${fmt(c.y2)} ${fmt(c.x)} ${fmt(c.y)}`
      }
      return `${c.op}${fmt(c.x)} ${fmt(c.y)}`
    })
    .join('')
}

/** フキダシの SVG path と塗り方。tail と ink は無ければ null */
export interface BubblePaths extends Pick<BubbleOutline, 'fill' | 'line'> {
  body: string
  tail: string | null
  ink: string | null
}

export function bubblePaths(shape: Shape, g: BubbleGeometry): BubblePaths {
  const o = bubbleOutline(shape, g)
  return {
    body: toPath(o.body) ?? '',
    tail: toPath(o.tail),
    ink: toPath(o.ink),
    fill: o.fill,
    line: o.line,
  }
}

/** 本体の輪郭の SVG path */
export const bodyPath = (shape: Shape, g: BubbleGeometry): string => bubblePaths(shape, g).body

/** しっぽの SVG path。しっぽが無いか、付かない形なら null */
export const tailPath = (shape: Shape, g: BubbleGeometry): string | null =>
  bubblePaths(shape, g).tail

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

  test('bubblePaths turns the outline into SVG paths', () => {
    const g = bubbleGeometry(bubble('narration'), panel)
    expect(bodyPath('narration', g)).toBe('M40 40L80 40L80 50L40 50Z')
    expect(bubblePaths('urchin', g).ink).toMatch(/^M.*Z$/)
    expect(bubblePaths('normal', g).ink).toBeNull()
  })

  test('tailPath reaches the tip, and is null without a tail or on a tailless shape', () => {
    const g = bubbleGeometry(bubble('normal', { x: 0, y: 1 }), panel)
    expect(tailPath('normal', g)).toContain('L10 70')
    expect(tailPath('thought', g)?.match(/M/g)).toHaveLength(2)
    expect(tailPath('narration', g)).toBeNull()
    expect(tailPath('normal', bubbleGeometry(bubble('normal'), panel))).toBeNull()
  })
}
