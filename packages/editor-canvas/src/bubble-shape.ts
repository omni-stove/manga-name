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
    tails: bubble.tails?.map((tail) => ({
      x: panel.x + tail.x * panel.w,
      y: panel.y + tail.y * panel.h,
    })),
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

/** フキダシの SVG path と塗り方。tails はしっぽごとで、無ければ空。ink は無ければ null */
export interface BubblePaths extends Pick<BubbleOutline, 'fill' | 'line'> {
  body: string
  tails: string[]
  ink: string | null
}

export function bubblePaths(shape: Shape, g: BubbleGeometry): BubblePaths {
  const o = bubbleOutline(shape, g)
  return {
    body: toPath(o.body) ?? '',
    tails: o.tails.flatMap((cmds) => toPath(cmds) ?? []),
    ink: toPath(o.ink),
    fill: o.fill,
    line: o.line,
  }
}

/** 本体の輪郭の SVG path */
export const bodyPath = (shape: Shape, g: BubbleGeometry): string => bubblePaths(shape, g).body

/** しっぽごとの SVG path。しっぽが無いか、付かない形なら空 */
export const tailPaths = (shape: Shape, g: BubbleGeometry): string[] => bubblePaths(shape, g).tails

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  const bubble = (shape: Shape, ...tails: { x: number; y: number }[]): Bubble => ({
    id: 'b',
    order: 1,
    text: '',
    shape,
    pos: { x: 0.5, y: 0.5 },
    size: { w: 0.4, h: 0.2 },
    ...(tails.length > 0 && { tails }),
  })
  const panel = { x: 10, y: 20, w: 100, h: 50 }

  test('bubbleGeometry places the bubble in page units', () => {
    expect(bubbleGeometry(bubble('normal', { x: 0, y: 1 }, { x: 1, y: 0 }), panel)).toEqual({
      cx: 60,
      cy: 45,
      rx: 20,
      ry: 5,
      tails: [
        { x: 10, y: 70 },
        { x: 110, y: 20 },
      ],
    })
  })

  test('bubblePaths turns the outline into SVG paths', () => {
    const g = bubbleGeometry(bubble('narration'), panel)
    expect(bodyPath('narration', g)).toBe('M40 40L80 40L80 50L40 50Z')
    expect(bubblePaths('urchin', g).ink).toMatch(/^M.*Z$/)
    expect(bubblePaths('normal', g).ink).toBeNull()
    const monologue = bubblePaths('monologue', g)
    expect(monologue.body).toMatch(/^M80 41L80 49C/)
    expect(monologue.body.match(/C/g)).toHaveLength(4)
    expect(monologue).toMatchObject({ fill: true, line: 'solid', tails: [] })
  })

  test('tailPaths reach each tip, and are empty without tails or on a tailless shape', () => {
    const g = bubbleGeometry(bubble('normal', { x: 0, y: 1 }, { x: 1, y: 0 }), panel)
    const [first, second] = tailPaths('normal', g)
    expect(first).toContain('L10 70')
    expect(second).toContain('L110 20')
    expect(tailPaths('thought', g).map((d) => d.match(/M/g)?.length)).toEqual([2, 2])
    expect(tailPaths('narration', g)).toEqual([])
    expect(tailPaths('monologue', g)).toEqual([])
    expect(tailPaths('normal', bubbleGeometry(bubble('normal'), panel))).toEqual([])
  })
}
