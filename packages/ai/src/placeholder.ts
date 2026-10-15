import type { Panel, ProjectSettings } from '@manga/schema'
import { encodeGrayPng } from './png'

const GRAY = 0xc0
const INK = 0x40
const LONG_SIDE = 512

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

class Raster {
  readonly pixels: Uint8Array
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height).fill(GRAY)
  }

  set(x: number, y: number) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) this.pixels[y * this.width + x] = INK
  }

  fill(x0: number, y0: number, w: number, h: number) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y)
  }

  line(x0: number, y0: number, x1: number, y1: number, thickness: number) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps)
      const y = Math.round(y0 + ((y1 - y0) * i) / steps)
      this.fill(x - (thickness >> 1), y - (thickness >> 1), thickness, thickness)
    }
  }

  text(digits: string, x0: number, y0: number, scale: number) {
    ;[...digits].forEach((d, i) => {
      const rows = DIGITS[d] ?? []
      rows.forEach((row, y) => {
        for (let x = 0; x < 5; x++) {
          if (row & (1 << (4 - x))) {
            this.fill(x0 + (i * 6 + x) * scale, y0 + y * scale, scale, scale)
          }
        }
      })
    })
  }
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
  const r = new Raster(size.w, size.h)
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
  return encodeGrayPng(size.w, size.h, r.pixels)
}
