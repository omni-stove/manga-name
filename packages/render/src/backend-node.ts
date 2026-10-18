import { fileURLToPath } from 'node:url'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import type { Backend } from './types'

/** @napi-rs/canvas で描く Backend。Node のテストとベンチで使う */
export function createNodeBackend(): Backend {
  return {
    createSurface(width, height) {
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      // 同梱の可変フォントは既定のインスタンスが Thin（wght 100）で、軸を指定しないと font-weight に関わらず Thin で描く。
      // ブラウザは font-weight を wght に当てるので、指定して揃える。bold はこの指定より font の太さが勝つ
      ctx.fontVariationSettings = '"wght" 400'
      return {
        ctx: ctx as unknown as CanvasRenderingContext2D,
        width,
        height,
        toPng: async () =>
          new Blob([new Uint8Array(await canvas.encode('png'))], { type: 'image/png' }),
      }
    },
    async decodeImage(blob) {
      const image = await loadImage(new Uint8Array(await blob.arrayBuffer()))
      return image as unknown as CanvasImageSource
    },
    async registerFont(family, url) {
      if (!GlobalFonts.registerFromPath(fileURLToPath(url), family)) {
        throw new Error(`failed to register ${family} from ${url.href}`)
      }
    },
  }
}
