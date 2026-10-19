import { cornerAnchor } from '@manga/schema'
import { FONT_FAMILY } from './backend'
import type { PxPoint, PxRect } from './geometry'
import { alphabeticY, wrapHorizontal } from './text'

type Ctx = CanvasRenderingContext2D

/** 輪郭を閉じたパスにする */
function tracePolygon(ctx: Ctx, outline: readonly PxPoint[]): void {
  ctx.beginPath()
  outline.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  })
  ctx.closePath()
}

/** 画像をコマを囲む rect に cover で置き、輪郭 outline からはみ出す部分は切る */
export function drawCover(
  ctx: Ctx,
  image: CanvasImageSource,
  rect: PxRect,
  outline: readonly PxPoint[],
): void {
  const iw = 'naturalWidth' in image ? image.naturalWidth : (image as { width: number }).width
  const ih = 'naturalHeight' in image ? image.naturalHeight : (image as { height: number }).height
  if (!(iw > 0 && ih > 0)) return
  const scale = Math.max(rect.w / iw, rect.h / ih)
  const w = iw * scale
  const h = ih * scale
  ctx.save()
  tracePolygon(ctx, outline)
  ctx.clip()
  ctx.drawImage(image, rect.x + (rect.w - w) / 2, rect.y + (rect.h - h) / 2, w, h)
  ctx.restore()
}

/** 輪郭 outline の外に出る部分を切って draw で描く */
export function withClip(ctx: Ctx, outline: readonly PxPoint[], draw: () => void): void {
  ctx.save()
  tracePolygon(ctx, outline)
  ctx.clip()
  draw()
  ctx.restore()
}

/** 輪郭 outline の内側を color で塗る。コマの地 */
export function fillOutline(ctx: Ctx, outline: readonly PxPoint[], color: string): void {
  ctx.save()
  ctx.fillStyle = color
  tracePolygon(ctx, outline)
  ctx.fill()
  ctx.restore()
}

export function drawFrame(ctx: Ctx, outline: readonly PxPoint[], lineWidth: number): void {
  ctx.save()
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = '#000'
  ctx.lineJoin = 'miter'
  tracePolygon(ctx, outline)
  ctx.stroke()
  ctx.restore()
}

/**
 * 未生成コマの中身。rect の左上にコマ番号、その下に camera と note を横書きで小さく。
 * 輪郭 outline の外に出る部分は切る
 */
export function drawPlaceholder(
  ctx: Ctx,
  panel: { order: number; camera?: string; note?: string },
  rect: PxRect,
  outline: readonly PxPoint[],
  fontPx: number,
): void {
  const pad = fontPx
  const numberPx = fontPx * 1.8
  ctx.save()
  tracePolygon(ctx, outline)
  ctx.clip()
  ctx.fillStyle = '#000'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `${numberPx}px "${FONT_FAMILY}"`
  ctx.fillText(String(panel.order), rect.x + pad, alphabeticY(rect.y + pad, numberPx, 'top'))

  ctx.font = `${fontPx}px "${FONT_FAMILY}"`
  const lineHeight = fontPx * 1.4
  let y = rect.y + pad + numberPx * 1.3
  const bottom = rect.y + rect.h - pad
  const text = [panel.camera && `[${panel.camera}]`, panel.note].filter(Boolean).join('\n')
  for (const line of wrapHorizontal(ctx, text, rect.w - pad * 2)) {
    if (y + lineHeight > bottom) break
    ctx.fillText(line, rect.x + pad, alphabeticY(y, fontPx, 'top'))
    y += lineHeight
  }
  ctx.restore()
}

/** 輪郭の右上のコマ番号。白丸に黒文字 */
export function drawPanelNumber(
  ctx: Ctx,
  order: number,
  outline: readonly PxPoint[],
  fontPx: number,
): void {
  const r = fontPx * 0.9
  const inset = r + fontPx * 0.4
  const { x: cx, y: cy } = cornerAnchor(outline, 'ne', -inset, inset)
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.lineWidth = Math.max(1, fontPx * 0.08)
  ctx.strokeStyle = '#000'
  ctx.stroke()
  ctx.fillStyle = '#000'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `${fontPx}px "${FONT_FAMILY}"`
  ctx.fillText(String(order), cx, alphabeticY(cy, fontPx, 'middle'))
  ctx.restore()
}

/** 余白のメモ。コマ番号と camera の行、続けて note を横書きで列挙する */
export function drawNotesMargin(
  ctx: Ctx,
  panels: { order: number; camera?: string; note?: string }[],
  area: PxRect,
  fontPx: number,
): void {
  const pad = fontPx
  const lineHeight = fontPx * 1.5
  const bottom = area.y + area.h - pad
  ctx.save()
  ctx.beginPath()
  ctx.rect(area.x, area.y, area.w, area.h)
  ctx.clip()
  ctx.fillStyle = '#000'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  let y = area.y + pad
  for (const panel of panels) {
    ctx.font = `bold ${fontPx}px "${FONT_FAMILY}"`
    const head = [String(panel.order), panel.camera].filter(Boolean).join(' ')
    for (const line of wrapHorizontal(ctx, head, area.w - pad * 2)) {
      ctx.fillText(line, area.x + pad, alphabeticY(y, fontPx, 'top'))
      y += lineHeight
    }
    ctx.font = `${fontPx}px "${FONT_FAMILY}"`
    for (const line of wrapHorizontal(ctx, panel.note ?? '', area.w - pad * 2)) {
      ctx.fillText(line, area.x + pad, alphabeticY(y, fontPx, 'top'))
      y += lineHeight
    }
    y += lineHeight * 0.5
    if (y > bottom) break
  }
  ctx.restore()
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { getBackend, loadFonts } = await import('./backend')

  const GREY = [128, 128, 128]
  const WHITE = [255, 255, 255]

  /** 灰色で塗った w x h の面に draw で描き、画素を RGB で読む関数と、暗い画素の数え上げを返す */
  const paint = async (w: number, h: number, draw: (ctx: Ctx) => void | Promise<void>) => {
    await loadFonts()
    const surface = (await getBackend()).createSurface(w, h)
    const ctx = surface.ctx
    ctx.fillStyle = 'rgb(128, 128, 128)'
    ctx.fillRect(0, 0, w, h)
    await draw(ctx)
    const data = ctx.getImageData(0, 0, w, h).data
    const at = (x: number, y: number) =>
      Array.from(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 3))
    /** inside が true を返す範囲の内と外で、灰色より暗い画素の数 */
    const darkPixels = (inside: (x: number, y: number) => boolean) => {
      const count = { inside: 0, outside: 0 }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if ((at(x, y)[0] as number) >= 100) continue
          if (inside(x, y)) count.inside++
          else count.outside++
        }
      }
      return count
    }
    return { at, darkPixels }
  }

  const square = (x: number, y: number, size: number): PxPoint[] => [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ]
  /** (0,0)-(100,0)-(0,100) の三角形 */
  const triangle: PxPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ]
  const inTriangle = (x: number, y: number) => x + y <= 101

  test('drawFrame strokes the outline in black and leaves the inside alone', async () => {
    const { at } = await paint(100, 100, (ctx) => drawFrame(ctx, square(20, 20, 60), 4))
    expect(at(20, 50)).toEqual([0, 0, 0])
    expect(at(80, 50)).toEqual([0, 0, 0])
    expect(at(50, 50)).toEqual(GREY)
    expect(at(10, 50)).toEqual(GREY)
  })

  test('fillOutline paints the inside of the outline and leaves the outside alone', async () => {
    const { at } = await paint(100, 100, (ctx) => fillOutline(ctx, triangle, '#000'))
    expect(at(10, 10)).toEqual([0, 0, 0])
    expect(at(80, 80)).toEqual(GREY)
  })

  describe('drawCover', () => {
    /** 左半分が赤、右半分が青の 20 x 10 の画像 */
    const twoTone = async () => {
      const backend = await getBackend()
      const source = backend.createSurface(20, 10)
      source.ctx.fillStyle = 'rgb(255, 0, 0)'
      source.ctx.fillRect(0, 0, 10, 10)
      source.ctx.fillStyle = 'rgb(0, 0, 255)'
      source.ctx.fillRect(10, 0, 10, 10)
      return backend.decodeImage(await source.toPng())
    }

    test('scales the image to cover the rect, centred, and clips it to the outline', async () => {
      const image = await twoTone()
      const rect = { x: 0, y: 0, w: 100, h: 100 }
      const { at } = await paint(100, 100, (ctx) => drawCover(ctx, image, rect, triangle))
      // 10 倍して幅 200 にし、中央の 100 を見せるので、左右半分ずつ赤と青になる
      expect(at(10, 10)).toEqual([255, 0, 0])
      expect(at(60, 10)).toEqual([0, 0, 255])
      expect(at(10, 80)).toEqual([255, 0, 0])
      expect(at(80, 80)).toEqual(GREY)
    })

    test('draws nothing for an image without size', async () => {
      const empty = { width: 0, height: 0 } as unknown as CanvasImageSource
      const { at } = await paint(10, 10, (ctx) =>
        drawCover(ctx, empty, { x: 0, y: 0, w: 10, h: 10 }, square(0, 0, 10)),
      )
      expect(at(5, 5)).toEqual(GREY)
    })
  })

  describe('drawPlaceholder', () => {
    const panel = { order: 3, camera: 'ロング', note: 'ガラス結晶の森を歩く。'.repeat(20) }

    test('writes the order and the text inside the outline only', async () => {
      const rect = { x: 0, y: 0, w: 100, h: 100 }
      const { darkPixels } = await paint(120, 120, (ctx) =>
        drawPlaceholder(ctx, panel, rect, triangle, 8),
      )
      const count = darkPixels(inTriangle)
      expect(count.inside).toBeGreaterThan(0)
      expect(count.outside).toBe(0)
    })

    test('the order number sits at the top-left of the rect', async () => {
      const rect = { x: 20, y: 20, w: 80, h: 80 }
      const { darkPixels } = await paint(120, 120, (ctx) =>
        drawPlaceholder(ctx, { order: 7 }, rect, square(20, 20, 80), 8),
      )
      // 余白 8px、数字は 14.4px
      const count = darkPixels((x, y) => x >= 28 && x < 45 && y >= 28 && y < 45)
      expect(count.inside).toBeGreaterThan(0)
      expect(count.outside).toBe(0)
    })

    test('stops writing lines before the bottom padding', async () => {
      const rect = { x: 0, y: 0, w: 100, h: 60 }
      const { darkPixels } = await paint(100, 100, (ctx) =>
        drawPlaceholder(ctx, panel, rect, square(0, 0, 100), 8),
      )
      expect(darkPixels((_, y) => y < 60 - 8).outside).toBe(0)
    })
  })

  test('drawPanelNumber draws a white disc with a dark ring at the top-right corner', async () => {
    // fontPx 20 なので半径 18、中心は右上の角から 26 内側の (74, 26)
    const { at } = await paint(100, 100, (ctx) => drawPanelNumber(ctx, 1, square(0, 0, 100), 20))
    expect(at(74, 13)).toEqual(WHITE)
    expect(at(62, 26)).toEqual(WHITE)
    expect((at(74, 8)[0] as number) < 160).toBe(true)
    expect(at(74, 2)).toEqual(GREY)
    expect(at(30, 70)).toEqual(GREY)
  })

  test('drawNotesMargin writes every panel inside the margin and clips the rest', async () => {
    const panels = [
      { order: 1, camera: 'ロング', note: 'ガラス結晶の森' },
      { order: 2, note: '見上げる' },
      { order: 3, camera: 'アップ', note: '新芽。'.repeat(80) },
    ]
    const area = { x: 100, y: 0, w: 60, h: 120 }
    const { darkPixels } = await paint(200, 160, (ctx) => drawNotesMargin(ctx, panels, area, 8))
    const count = darkPixels((x, y) => x >= 100 && x < 160 && y < 120)
    expect(count.inside).toBeGreaterThan(0)
    expect(count.outside).toBe(0)
  })
}
