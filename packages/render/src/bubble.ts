import {
  BUBBLE_DASH,
  type Bubble,
  type BubbleGeometry,
  bubbleNeck,
  bubbleOutline,
  type PathCommand,
} from '@manga/schema'
import { type PxRect, pointToPx, sizeToPx } from './geometry'

type Shape = Bubble['shape']
type Ctx = CanvasRenderingContext2D

/** コマ内座標の Bubble を px にする */
export function bubbleGeometry(bubble: Bubble, panel: PxRect): BubbleGeometry {
  const { x: cx, y: cy } = pointToPx(bubble.pos, panel)
  const { w, h } = sizeToPx(bubble.size, panel)
  return {
    cx,
    cy,
    rx: w / 2,
    ry: h / 2,
    tails: bubble.tails?.map((tail) => pointToPx(tail, panel)),
  }
}

/** 命令列のサブパスを現在のパスに足す。beginPath は呼ばない */
function trace(ctx: Ctx, cmds: readonly PathCommand[]): void {
  for (const c of cmds) {
    if (c.op === 'M') ctx.moveTo(c.x, c.y)
    else if (c.op === 'L') ctx.lineTo(c.x, c.y)
    else if (c.op === 'Q') ctx.quadraticCurveTo(c.x1, c.y1, c.x, c.y)
    else if (c.op === 'C') ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y)
    else ctx.closePath()
  }
}

// 本体としっぽは向きの違うサブパスになりうるので、1 つのパスで塗ると重なりが穴になる
function fillEach(ctx: Ctx, ...parts: readonly PathCommand[][]): void {
  for (const cmds of parts) {
    if (cmds.length === 0) continue
    ctx.beginPath()
    trace(ctx, cmds)
    ctx.fill()
  }
}

/**
 * bubble の joinedTo が指す、bubbles のうちのフキダシの px の位置。つないでいないか、相手が無ければ undefined。
 * bubbles には同じコマのフキダシを渡す
 */
export function joinedGeometry(
  bubble: Bubble,
  bubbles: readonly Bubble[],
  panel: PxRect,
): BubbleGeometry | undefined {
  if (bubble.joinedTo === undefined || bubble.joinedTo === bubble.id) return undefined
  const to = bubbles.find((b) => b.id === bubble.joinedTo)
  return to && bubbleGeometry(to, panel)
}

/**
 * 本体としっぽの領域を color で塗る。joined を渡すと、そこへの首も塗る。枠なしの形も塗る。配置図はこれだけを使う
 */
export function fillBubble(
  ctx: Ctx,
  shape: Shape,
  g: BubbleGeometry,
  color: string,
  joined?: BubbleGeometry,
): void {
  const { body, tails } = bubbleOutline(shape, g)
  ctx.fillStyle = color
  fillEach(ctx, body, ...tails, joined ? bubbleNeck(g, joined) : [])
}

/** 命令列の点と制御点を囲む矩形。クリップ用 */
function bounds(cmds: readonly PathCommand[], margin: number): PxRect {
  const xs: number[] = []
  const ys: number[] = []
  for (const c of cmds) {
    if (c.op === 'Z') continue
    xs.push(c.x)
    ys.push(c.y)
    if (c.op === 'Q' || c.op === 'C') {
      xs.push(c.x1)
      ys.push(c.y1)
    }
    if (c.op === 'C') {
      xs.push(c.x2)
      ys.push(c.y2)
    }
  }
  const x = Math.min(...xs) - margin
  const y = Math.min(...ys) - margin
  return { x, y, w: Math.max(...xs) + margin - x, h: Math.max(...ys) + margin - y }
}

/** cmds の輪郭を、others のどれかの内側を除いて引く */
function strokeOutside(
  ctx: Ctx,
  cmds: readonly PathCommand[],
  others: readonly (readonly PathCommand[])[],
  box: PxRect,
): void {
  ctx.save()
  // 重なったしっぽを 1 つのパスで evenodd に切ると重なりが切り抜きに残るので、1 つずつ切り重ねる
  for (const other of others) {
    ctx.beginPath()
    ctx.rect(box.x, box.y, box.w, box.h)
    trace(ctx, other)
    ctx.clip('evenodd')
  }
  ctx.beginPath()
  trace(ctx, cmds)
  ctx.stroke()
  ctx.restore()
}

/** 連結フキダシの 1 つ。joined はつなぐ相手の位置で、そこまでの首をこのフキダシの地の色と線で描く */
interface JoinedBubble {
  shape: Shape
  g: BubbleGeometry
  fill?: Bubble['fill']
  joined?: BubbleGeometry
}

/**
 * 形ごとの塗りと線でフキダシを描く。しっぽは付け根に線を引かず本体と繋げる。
 * fill が black なら本体としっぽを黒で塗る。地を持たない形では fill を無視する
 */
function drawBubble(
  ctx: Ctx,
  shape: Shape,
  g: BubbleGeometry,
  lineWidth: number,
  fill?: Bubble['fill'],
): void {
  drawJoinedBubbles(ctx, [{ shape, g, fill }], lineWidth)
}

/**
 * つないだフキダシを 1 つの輪郭に描く。本体、しっぽ、首が重なる境には線を引かず、外周だけに引く。
 * どの部分も持ち主のフキダシの形と fill で塗り、線を引く。1 つだけなら drawBubble と同じ
 */
export function drawJoinedBubbles(
  ctx: Ctx,
  bubbles: readonly JoinedBubble[],
  lineWidth: number,
): void {
  const items = bubbles.map((b) => {
    const o = bubbleOutline(b.shape, b.g)
    const neck = b.joined ? bubbleNeck(b.g, b.joined) : []
    const parts = neck.length > 0 ? [o.body, ...o.tails, neck] : [o.body, ...o.tails]
    return { o, fill: b.fill, parts }
  })
  ctx.save()
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = '#000'
  ctx.lineJoin = 'round'
  // 隣の塗りが先に引いた線を隠さないよう、全部を塗ってから線を引く
  for (const { o, fill, parts } of items) {
    if (!o.fill) continue
    ctx.fillStyle = fill === 'black' ? '#000' : '#fff'
    fillEach(ctx, ...parts)
  }
  // 塗らない形は下の線を隠さないので、編集画面と同じく線を切り抜くのは塗る部分だけ
  const painted = items.filter((i) => i.o.fill).flatMap((i) => i.parts)
  const box = bounds(items.flatMap((i) => i.parts.flat()), lineWidth * 4)
  for (const { o, parts } of items) {
    if (o.line === 'none') continue
    ctx.setLineDash(o.line === 'dashed' ? BUBBLE_DASH.map((d) => d * lineWidth) : [])
    for (const part of parts) {
      const others = painted.filter((p) => p !== part)
      if (others.length > 0) {
        strokeOutside(ctx, part, others, box)
        continue
      }
      ctx.beginPath()
      trace(ctx, part)
      ctx.stroke()
    }
  }
  for (const { o } of items) {
    if (o.ink.length === 0) continue
    ctx.fillStyle = '#000'
    ctx.beginPath()
    trace(ctx, o.ink)
    ctx.fill()
  }
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
  const tailed = { ...body, tails: [{ x: 100, y: 190 }] }

  test('bubbleGeometry maps pos, size and tails into the panel in px', () => {
    const bubble: Bubble = {
      id: 'bb',
      order: 1,
      text: '',
      shape: 'normal',
      pos: { x: 0.5, y: 0.25 },
      size: { w: 0.2, h: 0.4 },
      tails: [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
    }
    const panel = { x: 100, y: 0, w: 200, h: 100 }
    expect(bubbleGeometry(bubble, panel)).toEqual({
      cx: 200,
      cy: 25,
      rx: 20,
      ry: 20,
      tails: [
        { x: 100, y: 100 },
        { x: 300, y: 0 },
      ],
    })
    expect(bubbleGeometry({ ...bubble, tails: undefined }, panel).tails).toBeUndefined()
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
      // しっぽの辺は引く。付け根は (89, 120.1) と (111, 120.1) あたり
      expect(dark(at(104, 162))).toBe(true)
      expect(dark(at(96, 162))).toBe(true)
      expect(dark(at(100, 60))).toBe(true)
      expect(at(130, 170)).toEqual(GREY)
    })

    test('each of two tails joins the body without an outline across its base', async () => {
      const tails = [
        { x: 100, y: 190 },
        { x: 190, y: 100 },
      ]
      const at = await paint((ctx) => drawBubble(ctx, 'normal', { ...body, tails }, 4))
      expect(at(100, 170)).toEqual([255, 255, 255])
      // 2 本目の付け根は (137, 95.3) と (137, 104.7) あたりで、本体の輪郭は x = 160 を通る
      expect(at(158, 100)).toEqual([255, 255, 255])
      expect(dark(at(180, 100))).toBe(true)
      expect(dark(at(100, 60))).toBe(true)
    })

    test('overlapping tails draw no outline inside each other', async () => {
      const tails = [
        { x: 90, y: 190 },
        { x: 110, y: 190 },
      ]
      const at = await paint((ctx) => drawBubble(ctx, 'normal', { ...body, tails }, 4))
      // 2 本の向かい合う辺は (100, 152) で交わる。その上は重なりで、下では辺が離れていく
      expect(at(100, 145)).toEqual([255, 255, 255])
      expect(dark(at(100, 156))).toBe(true)
    })

    test('joined bubbles share one outline, with no line across the neck at either body', async () => {
      const left = { cx: 50, cy: 100, rx: 35, ry: 30 }
      const right = { cx: 150, cy: 100, rx: 35, ry: 30 }
      const at = await paint((ctx) =>
        drawJoinedBubbles(
          ctx,
          [
            { shape: 'normal', g: left, joined: right },
            { shape: 'normal', g: right },
          ],
          4,
        ),
      )
      const white = [255, 255, 255]
      // 首は y 94.6..105.4 の帯で、左右の本体の輪郭は x = 85 と 115 を通る
      expect(at(85, 100)).toEqual(white)
      expect(at(100, 100)).toEqual(white)
      expect(at(115, 100)).toEqual(white)
      expect(dark(at(100, 94))).toBe(true)
      expect(dark(at(100, 106))).toBe(true)
      // 首の辺は本体の中まで伸ばさない
      expect(at(70, 94)).toEqual(white)
      expect(at(100, 85)).toEqual(GREY)
      expect(dark(at(50, 70))).toBe(true)
      expect(dark(at(150, 130))).toBe(true)
    })

    test('a shout bubble is spiky: the gaps between spikes stay outside', async () => {
      const ring = async (shape: Shape) => {
        const at = await paint((ctx) => drawBubble(ctx, shape, body, 1))
        return Array.from({ length: 72 }, (_, i) => (i * Math.PI) / 36).map((a) =>
          at(Math.round(100 + 57 * Math.cos(a)), Math.round(100 + 38 * Math.sin(a))),
        )
      }
      const shout = await ring('shout')
      expect(shout).toContainEqual(GREY)
      expect(shout).toContainEqual([255, 255, 255])
      expect(await ring('normal')).not.toContainEqual(GREY)
    })

    test('a whisper bubble has a dashed outline', async () => {
      const at = await paint((ctx) => drawBubble(ctx, 'whisper', body, 2))
      const edge = Array.from({ length: 30 }, (_, i) => at(100 + i, 60))
      expect(edge.some(dark)).toBe(true)
      expect(edge.some((rgb) => !dark(rgb))).toBe(true)
    })

    test('narration is a square-cornered box and draws no tail', async () => {
      const at = await paint((ctx) => drawBubble(ctx, 'narration', tailed, 2))
      expect(at(157, 137)).toEqual([255, 255, 255])
      expect(dark(at(160, 140))).toBe(true)
      expect(at(100, 170)).toEqual(GREY)
    })

    test('urchin has no outline, but rays outside a white body', async () => {
      const at = await paint((ctx) => drawBubble(ctx, 'urchin', body, 2))
      expect(at(155, 100)).toEqual([255, 255, 255])
      const rays = Array.from({ length: 40 }, (_, i) => at(100 + i - 20, 146))
      expect(rays.some(dark)).toBe(true)
    })

    test('none draws nothing', async () => {
      const at = await paint((ctx) => drawBubble(ctx, 'none', tailed, 2))
      expect(at(100, 100)).toEqual(GREY)
      expect(at(160, 140)).toEqual(GREY)
    })

    test('a black bubble fills the body and the tail black, and none still draws nothing', async () => {
      const at = await paint((ctx) => drawBubble(ctx, 'normal', tailed, 4, 'black'))
      expect(at(100, 100)).toEqual([0, 0, 0])
      expect(at(100, 160)).toEqual([0, 0, 0])
      expect(at(190, 100)).toEqual(GREY)
      const none = await paint((ctx) => drawBubble(ctx, 'none', tailed, 2, 'black'))
      expect(none(100, 100)).toEqual(GREY)
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
    const at = await paint((ctx) => fillBubble(ctx, 'normal', tailed, 'rgb(255, 0, 0)'))
    expect(at(100, 100)).toEqual([255, 0, 0])
    expect(at(100, 170)).toEqual([255, 0, 0])
    expect(at(100, 195)).toEqual(GREY)
    expect(at(157, 100)).toEqual([255, 0, 0])
    expect(at(170, 100)).toEqual(GREY)
  })

  test('fillBubble fills a box shape to its corners, even the unpainted none', async () => {
    const at = await paint((ctx) => fillBubble(ctx, 'none', body, 'rgb(255, 0, 0)'))
    expect(at(158, 138)).toEqual([255, 0, 0])
  })
}
