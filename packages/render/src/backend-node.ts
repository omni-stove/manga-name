import { fileURLToPath } from 'node:url'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import type { Backend } from './backend'

/** @napi-rs/canvas で描く Backend。Node のテストとベンチで使う */
export function createNodeBackend(): Backend {
  return {
    createSurface(width, height) {
      const canvas = createCanvas(width, height)
      return {
        ctx: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
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
