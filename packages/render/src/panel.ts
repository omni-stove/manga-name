import { m } from '@manga/i18n'
import {
  type Character,
  cornerAnchor,
  type Panel,
  panelActing,
  sceneHeading,
  softEdgeStrokes,
} from '@manga/schema'
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

/**
 * 輪郭 outline に枠線を引く。dashed は破線、double は太い黒線の中央を白で抜いた二重線にし、
 * 他は実線。枠線を引かない枠（hasFrameLine が false）かは呼び出し側が見る
 */
export function drawFrame(
  ctx: Ctx,
  outline: readonly PxPoint[],
  lineWidth: number,
  frame: Panel['frame'],
): void {
  const stroke = (width: number, color: string) => {
    ctx.lineWidth = width
    ctx.strokeStyle = color
    tracePolygon(ctx, outline)
    ctx.stroke()
  }
  ctx.save()
  ctx.lineJoin = 'miter'
  if (frame === 'dashed') ctx.setLineDash([lineWidth * 4, lineWidth * 3])
  if (frame === 'double') {
    stroke(lineWidth * 4, '#000')
    stroke(lineWidth * 2, '#fff')
  } else stroke(lineWidth, '#000')
  ctx.restore()
}

/** ぼかし枠。輪郭 outline の内側の縁を、softEdgeStrokes の線で地の色 color へぼかす */
export function drawSoftEdge(
  ctx: Ctx,
  outline: readonly PxPoint[],
  unit: number,
  color: string,
): void {
  withClip(ctx, outline, () => {
    ctx.strokeStyle = color
    ctx.lineJoin = 'round'
    for (const { width, alpha } of softEdgeStrokes(unit)) {
      ctx.globalAlpha = alpha
      ctx.lineWidth = width
      tracePolygon(ctx, outline)
      ctx.stroke()
    }
  })
}

/** 効果線の多角形 lines を color で塗り、輪郭 outline の外に出た部分を切る */
export function drawEffectLines(
  ctx: Ctx,
  outline: readonly PxPoint[],
  lines: readonly (readonly PxPoint[])[],
  color: string,
): void {
  if (lines.length === 0) return
  withClip(ctx, outline, () => {
    ctx.fillStyle = color
    ctx.beginPath()
    for (const line of lines) {
      line.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.closePath()
    }
    ctx.fill()
  })
}

/** 画素 data（RGBA）を、TONE_MATRICES と同じ並びの色の行列 matrix で書き換える */
export function applyColorMatrix(data: Uint8ClampedArray, matrix: readonly number[]): void {
  const k = (i: number) => matrix[i] ?? 0
  for (let i = 0; i < data.length; i += 4) {
    const r = (data[i] ?? 0) / 255
    const g = (data[i + 1] ?? 0) / 255
    const b = (data[i + 2] ?? 0) / 255
    const a = (data[i + 3] ?? 0) / 255
    for (let row = 0; row < 4; row++) {
      const o = row * 5
      const v = k(o) * r + k(o + 1) * g + k(o + 2) * b + k(o + 3) * a + k(o + 4)
      data[i + row] = Math.round(v * 255)
    }
  }
}

/** 指示メモに載せるコマの項目 */
type PanelNotes = Pick<Panel, 'order' | 'camera' | 'note' | 'scene' | 'beat'>

/**
 * 未生成コマの中身。rect の左上にコマ番号、その下に「間」の印、camera と note を横書きで小さく。
 * 輪郭 outline の外に出る部分は切る
 */
export function drawPlaceholder(
  ctx: Ctx,
  panel: Omit<PanelNotes, 'scene'>,
  rect: PxRect,
  outline: readonly PxPoint[],
  fontPx: number,
  ink = '#000',
): void {
  const pad = fontPx
  const numberPx = fontPx * 1.8
  ctx.save()
  tracePolygon(ctx, outline)
  ctx.clip()
  ctx.fillStyle = ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `${numberPx}px "${FONT_FAMILY}"`
  ctx.fillText(String(panel.order), rect.x + pad, alphabeticY(rect.y + pad, numberPx, 'top'))

  ctx.font = `${fontPx}px "${FONT_FAMILY}"`
  const lineHeight = fontPx * 1.4
  let y = rect.y + pad + numberPx * 1.3
  const bottom = rect.y + rect.h - pad
  const text = [
    panel.beat && m.panel_beat_mark(),
    panel.camera && `[${m[`panel_camera_${panel.camera}` as const]()}]`,
    panel.note,
  ]
    .filter(Boolean)
    .join('\n')
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

/** 指示メモに書く芝居。1 人 1 行で「名前：芝居」 */
export function actingNotes(panel: Panel, characters: readonly Character[]): string[] {
  return panelActing(panel).flatMap(({ characterId, text }) =>
    characters.filter((c) => c.id === characterId).map((c) => `${c.name}：${text.trim()}`),
  )
}

/**
 * 余白のメモ。シーンの始まるコマではまず見出しの行、続けてコマ番号と camera と「間」の印の行、note と芝居（actingNotes）を横書きで列挙する
 */
export function drawNotesMargin(
  ctx: Ctx,
  panels: (PanelNotes & { acting?: readonly string[] })[],
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
    const scene = sceneHeading(panel)
    const head = [
      String(panel.order),
      panel.camera && m[`panel_camera_${panel.camera}` as const](),
      panel.beat && m.panel_beat_mark(),
    ]
      .filter(Boolean)
      .join(' ')
    const heads = scene === undefined ? [head] : [m.panel_scene_heading({ scene }), head]
    for (const line of heads.flatMap((h) => wrapHorizontal(ctx, h, area.w - pad * 2))) {
      ctx.fillText(line, area.x + pad, alphabeticY(y, fontPx, 'top'))
      y += lineHeight
    }
    ctx.font = `${fontPx}px "${FONT_FAMILY}"`
    for (const text of [panel.note ?? '', ...(panel.acting ?? [])]) {
      for (const line of wrapHorizontal(ctx, text, area.w - pad * 2)) {
        ctx.fillText(line, area.x + pad, alphabeticY(y, fontPx, 'top'))
        y += lineHeight
      }
    }
    y += lineHeight * 0.5
    if (y > bottom) break
  }
  ctx.restore()
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { getBackend, loadFonts } = await import('./backend')
  const { TONE_MATRICES } = await import('@manga/schema')

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
    const { at } = await paint(100, 100, (ctx) => drawFrame(ctx, square(20, 20, 60), 4, undefined))
    expect(at(20, 50)).toEqual([0, 0, 0])
    expect(at(80, 50)).toEqual([0, 0, 0])
    expect(at(50, 50)).toEqual(GREY)
    expect(at(10, 50)).toEqual(GREY)
  })

  test('drawFrame dashes the dashed frame and hollows the double frame with white', async () => {
    const dashed = await paint(100, 100, (ctx) => drawFrame(ctx, square(20, 20, 60), 2, 'dashed'))
    const column = Array.from({ length: 60 }, (_, i) => dashed.at(20, 20 + i)[0])
    expect(column).toContain(0)
    expect(column).toContain(128)

    const double = await paint(100, 100, (ctx) => drawFrame(ctx, square(20, 20, 60), 2, 'double'))
    expect(double.at(20, 50)).toEqual(WHITE)
    expect(double.at(17, 50)).toEqual([0, 0, 0])
    expect(double.at(23, 50)).toEqual([0, 0, 0])
    expect(double.at(50, 50)).toEqual(GREY)
  })

  test('drawSoftEdge fades the inside edge to the colour and leaves the centre and outside alone', async () => {
    const { at } = await paint(100, 100, (ctx) => drawSoftEdge(ctx, square(0, 0, 100), 100, '#fff'))
    // 縁の画素の中心は輪郭から 0.5px 内側なので、ほぼ白
    expect(at(0, 50)[0]).toBeGreaterThan(240)
    const [mid] = at(2, 50)
    expect(mid).toBeGreaterThan(128)
    expect(mid).toBeLessThan(255)
    expect(at(50, 50)).toEqual(GREY)
  })

  test('applyColorMatrix maps each pixel through the matrix', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
    applyColorMatrix(data, TONE_MATRICES.faded)
    expect([...data]).toEqual([255, 255, 255, 255, 102, 102, 102, 255])
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
    const panel = { order: 3, camera: 'long' as const, note: 'ガラス結晶の森を歩く。'.repeat(20) }

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

    test('marks a beat panel under the order number', async () => {
      const rect = { x: 0, y: 0, w: 100, h: 100 }
      // 余白 8px、数字は 14.4px なので、数字の下の行は y 26.72 から
      const below = (x: number, y: number) => y >= 26
      const draw = (beat?: true) =>
        paint(100, 100, (ctx) =>
          drawPlaceholder(ctx, { order: 1, beat }, rect, square(0, 0, 100), 8),
        )
      expect((await draw()).darkPixels(below).inside).toBe(0)
      expect((await draw(true)).darkPixels(below).inside).toBeGreaterThan(0)
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
      { order: 1, camera: 'long' as const, note: 'ガラス結晶の森' },
      { order: 2, note: '見上げる' },
      { order: 3, camera: 'close_up' as const, note: '新芽。'.repeat(80) },
    ]
    const area = { x: 100, y: 0, w: 60, h: 120 }
    const { darkPixels } = await paint(200, 160, (ctx) => drawNotesMargin(ctx, panels, area, 8))
    const count = darkPixels((x, y) => x >= 100 && x < 160 && y < 120)
    expect(count.inside).toBeGreaterThan(0)
    expect(count.outside).toBe(0)
  })

  test('drawNotesMargin puts the scene heading on its own line before the panel', async () => {
    const area = { x: 0, y: 0, w: 100, h: 100 }
    // 余白 8px、行送り 12px なので、2 行目は y 20 から
    const second = (_: number, y: number) => y >= 20
    const draw = (panel: PanelNotes) =>
      paint(100, 100, (ctx) => drawNotesMargin(ctx, [panel], area, 8))
    expect((await draw({ order: 1, beat: true })).darkPixels(second).inside).toBe(0)
    const scened = await draw({ order: 1, scene: '放課後・屋上', beat: true })
    expect(scened.darkPixels(second).inside).toBeGreaterThan(0)
  })

  test('drawNotesMargin writes the acting on the lines after the note', async () => {
    const area = { x: 0, y: 0, w: 200, h: 120 }
    // 余白 8、fontPx 8、行の高さ 12 なので、番号の行は y 8、note の行は y 20 から 8px の高さに描く
    const below = (acting?: string[]) =>
      paint(200, 120, (ctx) =>
        drawNotesMargin(ctx, [{ order: 1, note: '見上げる', acting }], area, 8),
      ).then(({ darkPixels }) => darkPixels((_, y) => y >= 31).inside)
    expect(await below()).toBe(0)
    expect(await below(['E：振り向いて驚く', 'ケイ：笑う'])).toBeGreaterThan(0)
  })

  test('actingNotes writes one line per acting character with the name', () => {
    const panel = {
      id: 'pn',
      order: 1,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      bubbles: [],
      focusPoints: [],
      vectors: [],
      arts: [],
      cast: ['a', 'b'],
      acting: [
        { characterId: 'b', text: ' 笑う ' },
        { characterId: 'a', text: '振り向いて驚く' },
      ],
    }
    const characters = [
      { id: 'a', name: 'エル', shortName: 'L' },
      { id: 'b', name: 'ケイ', shortName: 'K' },
    ]
    expect(actingNotes(panel, characters)).toEqual(['エル：振り向いて驚く', 'ケイ：笑う'])
    expect(actingNotes({ ...panel, acting: undefined }, characters)).toEqual([])
  })
}
