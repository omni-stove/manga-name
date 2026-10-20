import type { Bubble } from '@manga/schema'
import type { Backend } from './types'

export const FONT_FAMILY = 'Noto Sans JP'
const MINCHO_FAMILY = 'Noto Serif JP'
const ROUNDED_FAMILY = 'M PLUS Rounded 1c'
const HAND_FAMILY = 'Yomogi'
type Family =
  | typeof FONT_FAMILY
  | typeof MINCHO_FAMILY
  | typeof ROUNDED_FAMILY
  | typeof HAND_FAMILY

// どれも Google Fonts から取った SIL OFL 1.1 のフォント。ライセンスは fonts/OFL*.txt
const FONTS: Record<Family, { url: URL; weight?: string }> = {
  // NotoSansJP[wght].ttf と NotoSerifJP[wght].ttf は可変フォント。太さの範囲を伝えないと、ブラウザは太字を合成する
  [FONT_FAMILY]: { url: new URL('../fonts/NotoSansJP.ttf', import.meta.url), weight: '100 900' },
  [MINCHO_FAMILY]: { url: new URL('../fonts/NotoSerifJP.ttf', import.meta.url), weight: '200 900' },
  [ROUNDED_FAMILY]: { url: new URL('../fonts/MPLUSRounded1c.ttf', import.meta.url) },
  [HAND_FAMILY]: { url: new URL('../fonts/Yomogi.ttf', import.meta.url) },
}

/**
 * 書体ごとの Canvas の font の字族と太さ。@napi-rs/canvas は可変フォントの wght を 400 か 700 にしか当てないので、
 * ブラウザの書き出しと揃うようこの 2 つに限る
 */
const TYPEFACES: Record<NonNullable<Bubble['typeface']>, { family: Family; weight: number }> = {
  gothic: { family: FONT_FAMILY, weight: 400 },
  bold: { family: FONT_FAMILY, weight: 700 },
  mincho: { family: MINCHO_FAMILY, weight: 400 },
  rounded: { family: ROUNDED_FAMILY, weight: 400 },
  hand: { family: HAND_FAMILY, weight: 400 },
}

/** Canvas の font に書く値 */
export function typefaceFont(typeface: NonNullable<Bubble['typeface']>, px: number): string {
  const { family, weight } = TYPEFACES[typeface]
  return `${weight} ${px}px "${family}"`
}

let backendPromise: Promise<Backend> | undefined
const registered = new Map<Family, Promise<void>>()

/** 実行環境に合う Backend。初回に決めて以後は同じものを返す */
export function getBackend(): Promise<Backend> {
  backendPromise ??=
    typeof OffscreenCanvas === 'function'
      ? Promise.resolve(createOffscreenBackend())
      : importNodeBackend()
  return backendPromise
}

/**
 * Noto Sans JP と、`typefaces` の書体が使うフォントを登録する。どのフォントも読み込みは 1 回。
 * 1 つが数 MB あるので、ページに無い書体のフォントは読み込まない
 */
export async function loadFonts(
  typefaces: Iterable<NonNullable<Bubble['typeface']>> = [],
): Promise<void> {
  const families = new Set<Family>([
    FONT_FAMILY,
    ...Array.from(typefaces, (t) => TYPEFACES[t].family),
  ])
  await Promise.all(Array.from(families, register))
}

/**
 * `typeface` の書体が使うフォントだけを登録する。ブラウザでは document.fonts に入るので、編集画面の SVG も同じ字形で描ける。
 * loadFonts と違い Noto Sans JP は読み込まない
 */
export function loadTypefaceFont(typeface: NonNullable<Bubble['typeface']>): Promise<void> {
  return register(TYPEFACES[typeface].family)
}

function register(family: Family): Promise<void> {
  let loading = registered.get(family)
  if (!loading) {
    const { url, weight } = FONTS[family]
    loading = getBackend()
      .then((backend) => backend.registerFont(family, url, weight))
      .catch((e: unknown) => {
        // 通信の失敗で読めなかったフォントを、次の呼び出しで読み直す
        registered.delete(family)
        throw e
      })
    registered.set(family, loading)
  }
  return loading
}

async function importNodeBackend(): Promise<Backend> {
  // 指定子を文字列リテラルにすると Vite が @napi-rs/canvas をブラウザ向けに束ねようとするので、変数にして解析から外す
  // 拡張子まで書くのは、apps/web のように Vite の root の外から /@fs で読むと拡張子を補わないため
  const specifier = './backend-node.ts'
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
    async registerFont(family, url, weight) {
      const face = new FontFace(family, `url(${url.href})`, weight ? { weight } : {})
      await face.load()
      // Worker では self.fonts、Window では document.fonts
      const scope = globalThis as { fonts?: FontFaceSet; document?: { fonts: FontFaceSet } }
      const fonts = scope.fonts ?? scope.document?.fonts
      if (!fonts) throw new Error('FontFaceSet is unavailable')
      fonts.add(face)
    },
  }
}
