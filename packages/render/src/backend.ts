/** 1 枚のキャンバス。描き終えたら toPng で PNG にする */
export interface Surface {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  toPng(): Promise<Blob>
}

/** 描画先の環境差を閉じ込める。ブラウザは OffscreenCanvas、Node は @napi-rs/canvas */
export interface Backend {
  createSurface(width: number, height: number): Surface
  decodeImage(blob: Blob): Promise<CanvasImageSource>
  registerFont(family: string, url: URL): Promise<void>
}

export const FONT_FAMILY = 'Noto Sans JP'
// Google Fonts の NotoSansJP[wght].ttf（SIL OFL 1.1、fonts/OFL.txt）
const FONT_URL = new URL('../fonts/NotoSansJP.ttf', import.meta.url)

let backendPromise: Promise<Backend> | undefined
let fontsPromise: Promise<void> | undefined

/** 実行環境に合う Backend。初回に決めて以後は同じものを返す */
export function getBackend(): Promise<Backend> {
  backendPromise ??=
    typeof OffscreenCanvas === 'function'
      ? Promise.resolve(createOffscreenBackend())
      : importNodeBackend()
  return backendPromise
}

/** Noto Sans JP を登録する。何度呼んでも読み込みは 1 回 */
export function loadFonts(): Promise<void> {
  fontsPromise ??= getBackend().then((backend) => backend.registerFont(FONT_FAMILY, FONT_URL))
  return fontsPromise
}

async function importNodeBackend(): Promise<Backend> {
  // 指定子を文字列リテラルにすると Vite が @napi-rs/canvas をブラウザ向けに束ねようとするので、変数にして解析から外す
  const specifier = './backend-node'
  const mod = (await import(/* @vite-ignore */ specifier)) as typeof import('./backend-node')
  return mod.createNodeBackend()
}

function createOffscreenBackend(): Backend {
  return {
    createSurface(width, height) {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2d context is unavailable')
      return {
        ctx: ctx as unknown as CanvasRenderingContext2D,
        width,
        height,
        toPng: () => canvas.convertToBlob({ type: 'image/png' }),
      }
    },
    decodeImage: (blob) => createImageBitmap(blob),
    async registerFont(family, url) {
      const face = new FontFace(family, `url(${url.href})`)
      await face.load()
      // Worker では self.fonts、Window では document.fonts
      const scope = globalThis as { fonts?: FontFaceSet; document?: { fonts: FontFaceSet } }
      const fonts = scope.fonts ?? scope.document?.fonts
      if (!fonts) throw new Error('FontFaceSet is unavailable')
      fonts.add(face)
    },
  }
}
