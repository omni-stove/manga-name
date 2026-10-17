import {
  type Page,
  type Panel,
  type Point,
  type ProjectSettings,
  panelOutline,
} from '@manga/schema'
import { encodeGrayPng } from './png'

const GRAY = 0xc0
const INK = 0x40
const LONG_SIDE = 512
/** ページ全体の代わりの画像の長辺。切り抜いた 1 コマが LONG_SIDE の矩形と見比べられる大きさにする */
const PAGE_LONG_SIDE = 1024
const PAPER = 0xff

/** 5x7 のビットマップ数字。上の行から、1 が点灯 */
const DIGITS: Record<string, number[]> = {
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
}

/** 灰色で初期化した width x height のグレー画素列と、そこに INK で描く関数 */
function createRaster(width: number, height: number) {
  const pixels = new Uint8Array(width * height).fill(GRAY)

  const set = (x: number, y: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) pixels[y * width + x] = INK
  }

  const fill = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y)
  }

  const line = (x0: number, y0: number, x1: number, y1: number, thickness: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps)
      const y = Math.round(y0 + ((y1 - y0) * i) / steps)
      fill(x - (thickness >> 1), y - (thickness >> 1), thickness, thickness)
    }
  }

  const text = (digits: string, x0: number, y0: number, scale: number) => {
    ;[...digits].forEach((d, i) => {
      const rows = DIGITS[d] ?? []
      rows.forEach((row, y) => {
        for (let x = 0; x < 5; x++) {
          if (row & (1 << (4 - x))) {
            fill(x0 + (i * 6 + x) * scale, y0 + y * scale, scale, scale)
          }
        }
      })
    })
  }

  return { pixels, fill, line, text }
}

/** コマの実寸の縦横比で、長辺を 512px にした出力サイズ */
export function placeholderSize(panel: Panel, settings: ProjectSettings): { w: number; h: number } {
  const aspect = (panel.rect.w * settings.pageSize.w) / (panel.rect.h * settings.pageSize.h)
  return aspect >= 1
    ? { w: LONG_SIDE, h: Math.max(1, Math.round(LONG_SIDE / aspect)) }
    : { w: Math.max(1, Math.round(LONG_SIDE * aspect)), h: LONG_SIDE }
}

/**
 * 生成画像の代わりになる灰色の矩形の PNG。枠線、対角線、コマ番号を描く。
 * 同じ引数からは常に同じバイト列になるので、docs/fixtures/art のフィクスチャはこれで作る。
 */
export function placeholderPng(
  order: number,
  size: { w: number; h: number },
): Uint8Array<ArrayBuffer> {
  return encodeGrayPng(size.w, size.h, placeholderPixels(order, size))
}

function placeholderPixels(order: number, size: { w: number; h: number }): Uint8Array {
  const r = createRaster(size.w, size.h)
  const border = Math.max(2, Math.round(Math.min(size.w, size.h) / 64))
  r.fill(0, 0, size.w, border)
  r.fill(0, size.h - border, size.w, border)
  r.fill(0, 0, border, size.h)
  r.fill(size.w - border, 0, border, size.h)
  r.line(0, 0, size.w - 1, size.h - 1, 1)
  r.line(size.w - 1, 0, 0, size.h - 1, 1)

  const digits = String(order)
  const scale = Math.max(2, Math.floor(Math.min(size.w, size.h) / 14))
  const textW = (digits.length * 6 - 1) * scale
  const textH = 7 * scale
  const x0 = Math.round((size.w - textW) / 2)
  const y0 = Math.round((size.h - textH) / 2)
  const pad = scale
  // 対角線の上に数字を置くと読めないので、数字の背景を塗り直す
  for (let y = y0 - pad; y < y0 + textH + pad; y++) {
    for (let x = x0 - pad; x < x0 + textW + pad; x++) {
      if (x >= 0 && x < size.w && y >= 0 && y < size.h) r.pixels[y * size.w + x] = GRAY
    }
  }
  r.text(digits, x0, y0, scale)
  return r.pixels
}

/** 点 p が多角形 outline の内側か。偶奇規則 */
function inside(outline: readonly Point[], p: Point): boolean {
  let hit = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i] as Point
    const b = outline[j] as Point
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit
    }
  }
  return hit
}

/**
 * ページ全体の生成画像の代わり。白地の各コマの輪郭の内側に、コマを囲む矩形の寸法で描いた placeholderPng の画素を置く。
 * 長辺 1024px で判型の縦横比。コマの rect で切り抜くと、そのコマの placeholderPng とほぼ同じ絵になる
 */
export function placeholderPagePng(page: Page, settings: ProjectSettings): Uint8Array<ArrayBuffer> {
  const aspect = settings.pageSize.w / settings.pageSize.h
  const width = aspect >= 1 ? PAGE_LONG_SIDE : Math.max(1, Math.round(PAGE_LONG_SIDE * aspect))
  const height = aspect >= 1 ? Math.max(1, Math.round(PAGE_LONG_SIDE / aspect)) : PAGE_LONG_SIDE
  const pixels = new Uint8Array(width * height).fill(PAPER)
  for (const panel of page.panels) {
    const x0 = Math.round(panel.rect.x * width)
    const y0 = Math.round(panel.rect.y * height)
    const w = Math.max(1, Math.round((panel.rect.x + panel.rect.w) * width) - x0)
    const h = Math.max(1, Math.round((panel.rect.y + panel.rect.h) * height) - y0)
    const art = placeholderPixels(panel.order, { w, h })
    const outline = panel.shape && panelOutline(panel)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x0 + x
        const py = y0 + y
        if (px >= width || py >= height) continue
        if (outline && !inside(outline, { x: (px + 0.5) / width, y: (py + 0.5) / height })) {
          continue
        }
        pixels[py * width + px] = art[y * w + x] as number
      }
    }
  }
  return encodeGrayPng(width, height, pixels)
}

if (import.meta.vitest) {
  const { fixtures } = await import('@manga/schema')
  const { expect, test } = import.meta.vitest

  const panel = fixtures.samplePage01.episodes[0]?.pages[0]?.panels[0] as Panel
  const settings = fixtures.samplePage01.settings
  const withRect = (w: number, h: number): Panel => ({ ...panel, rect: { x: 0, y: 0, w, h } })
  const page = (w: number, h: number): ProjectSettings => ({
    ...settings,
    pageSize: { ...settings.pageSize, w, h },
  })

  /** IDAT を実行環境の inflate で解き、行頭のフィルタ種別を除いた画素の読み出し関数にする */
  const decode = async (png: Uint8Array) => {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const width = view.getUint32(16)
    const height = view.getUint32(20)
    const idatLength = view.getUint32(33)
    const idat = png.subarray(41, 41 + idatLength)
    const stream = new Blob([idat as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
    const raw = new Uint8Array(await new Response(stream).arrayBuffer())
    return { width, height, at: (x: number, y: number) => raw[y * (width + 1) + 1 + x] }
  }

  test('placeholderSize keeps the real aspect ratio with a 512px long side', () => {
    expect(placeholderSize(withRect(0.5, 0.5), page(100, 200))).toEqual({ w: 256, h: 512 })
    expect(placeholderSize(withRect(0.5, 0.25), page(100, 100))).toEqual({ w: 512, h: 256 })
    expect(placeholderSize(withRect(1, 1), page(100, 100))).toEqual({ w: 512, h: 512 })
    expect(placeholderSize(withRect(1, 0.0001), page(100, 100))).toEqual({ w: 512, h: 1 })
  })

  test('placeholderPng draws the border, both diagonals and the order on grey', async () => {
    const png = await decode(placeholderPng(3, { w: 64, h: 32 }))
    expect([png.width, png.height]).toEqual([64, 32])
    expect([png.at(0, 0), png.at(1, 1), png.at(63, 31), png.at(5, 30)]).toEqual([
      INK,
      INK,
      INK,
      INK,
    ])
    expect(png.at(5, 16)).toBe(GRAY)
    expect(png.at(10, Math.round((10 * 31) / 63))).toBe(INK)
    expect(png.at(10, Math.round(31 - (10 * 31) / 63))).toBe(INK)
    // 数字 3 は scale 2 で x 27..36、y 9..22。最上段は 5 マス全部が点灯する
    for (let x = 27; x < 37; x++) expect(png.at(x, 9)).toBe(INK)
    expect(png.at(31, 15)).toBe(GRAY)
    expect(png.at(32, 16)).toBe(GRAY)
  })

  test('placeholderPagePng puts each panel placeholder at its rect on white paper', async () => {
    const sample = fixtures.samplePage01.episodes[0]?.pages[0] as Page
    const png = await decode(placeholderPagePng(sample, settings))
    expect(png.height).toBe(1024)
    expect(png.width).toBe(Math.round((1024 * settings.pageSize.w) / settings.pageSize.h))
    for (const p of sample.panels) {
      // 矩形の左上の角は placeholderPng の枠線
      const x = Math.round(p.rect.x * png.width)
      const y = Math.round(p.rect.y * png.height)
      expect(png.at(x, y), p.id).toBe(INK)
    }
    // pn_3 と pn_2 の間の隙間は紙の白
    expect(png.at(Math.round(0.49 * png.width), Math.round(0.39 * png.height))).toBe(PAPER)
  })

  test('placeholderPagePng leaves the outside of a shaped panel white', async () => {
    const triangle: Page = {
      id: 'pg',
      side: 'single',
      scribbles: [],
      panels: [
        {
          ...panel,
          rect: { x: 0, y: 0, w: 1, h: 1 },
          shape: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
        },
      ],
    }
    const png = await decode(placeholderPagePng(triangle, page(100, 100)))
    expect(png.at(10, 50)).not.toBe(PAPER)
    expect(png.at(1000, 1000)).toBe(PAPER)
  })

  test('placeholderPng is byte-for-byte deterministic and differs by order', () => {
    const size = { w: 40, h: 60 }
    expect(placeholderPng(12, size)).toEqual(placeholderPng(12, size))
    expect(placeholderPng(12, size)).not.toEqual(placeholderPng(13, size))
  })
}
