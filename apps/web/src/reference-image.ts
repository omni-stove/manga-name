import { m } from '@manga/i18n'
import type { Page, Patch, ProjectSettings, Rect } from '@manga/schema'

/** 参考画像を保存するときの長辺の上限（px）。大きな画像でキャンバス操作が重くならないよう読み込み時に縮める */
const REFERENCE_MAX_SIDE = 2048

/**
 * キャラの参照画像の長辺の上限（px）と JPEG の品質。コマを生成するたびに登場キャラの分だけ送るので、
 * 見た目が伝わる範囲でページの参考画像より小さくする
 */
const CHARACTER_MAX_SIDE = 1024
const CHARACTER_JPEG_QUALITY = 0.85

type ReferenceFormat = 'png' | 'jpeg' | 'webp' | 'pdf'

/** 描ける画像。`draw` は (0, 0) から width × height に引き伸ばして描く */
interface Raster {
  width: number
  height: number
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void
  close?(): void
}

/** 画像のデコード、PDF のラスタライズ、エンコード。テストでは差し替える */
export interface ReferenceCodec {
  decodeImage(blob: Blob): Promise<Raster>
  /** 1 ページ目を長辺 maxSide px で描く */
  rasterizePdf(blob: Blob, maxSide: number): Promise<Raster>
  /** quality は JPEG のときだけ効く */
  encode(
    raster: Raster,
    width: number,
    height: number,
    type: string,
    quality: number,
  ): Promise<Blob>
}

/**
 * 先頭のバイトで形式を判定する。クリップボードやドロップの File は MIME が空のことがあるので、
 * `blob.type` には頼らない。対応外は null
 */
async function sniffFormat(blob: Blob): Promise<ReferenceFormat | null> {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  const starts = (bytes: number[], offset = 0) => bytes.every((b, i) => head[offset + i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (starts([0xff, 0xd8, 0xff])) return 'jpeg'
  // RIFF コンテナの 8 バイト目からが形式名
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp'
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'
  return null
}

/** アスペクト比を保って長辺を maxSide 以下にした整数の寸法。小さい画像は拡大しない */
function fitLongSide(
  width: number,
  height: number,
  maxSide = REFERENCE_MAX_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** 形式を判定して描ける画像にする。PDF は 1 ページ目を長辺 maxSide で描く。対応外の形式は throw する */
async function decodeReference(
  blob: Blob,
  codec: ReferenceCodec,
  maxSide: number,
): Promise<{ format: ReferenceFormat; raster: Raster }> {
  const format = await sniffFormat(blob)
  if (format === null) throw new Error(m.web_reference_unsupported_format())
  const raster =
    format === 'pdf' ? await codec.rasterizePdf(blob, maxSide) : await codec.decodeImage(blob)
  return { format, raster }
}

/**
 * PNG / JPEG / WebP / PDF を保存用の画像にする。PDF は 1 ページ目を PNG に、長辺が
 * REFERENCE_MAX_SIDE を超える画像は縮めて同じ形式（WebP は PNG）にする。収まっている PNG / JPEG / WebP はそのまま返す。
 * 対応外の形式は throw する
 */
export async function toReferenceImage(
  blob: Blob,
  codec: ReferenceCodec = browserCodec,
): Promise<Blob> {
  const { format, raster } = await decodeReference(blob, codec, REFERENCE_MAX_SIDE)
  try {
    const size = fitLongSide(raster.width, raster.height)
    if (format !== 'pdf' && size.width === raster.width && size.height === raster.height) {
      return new Blob([blob], { type: `image/${format}` })
    }
    // macOS の WebView（WebKit）の canvas は WebP に書き出せないので、縮めた WebP は PNG にする
    const type = format === 'jpeg' ? 'image/jpeg' : 'image/png'
    return await codec.encode(raster, size.width, size.height, type, 0.92)
  } finally {
    raster.close?.()
  }
}

/**
 * PNG / JPEG / WebP / PDF をキャラの参照画像として保存する JPEG にする。長辺を CHARACTER_MAX_SIDE 以下に縮め、
 * 透過は白で埋める。収まっている JPEG はそのまま返す。対応外の形式は throw する
 */
export async function toCharacterImage(
  blob: Blob,
  codec: ReferenceCodec = browserCodec,
): Promise<Blob> {
  const { format, raster } = await decodeReference(blob, codec, CHARACTER_MAX_SIDE)
  try {
    const size = fitLongSide(raster.width, raster.height, CHARACTER_MAX_SIDE)
    if (format === 'jpeg' && size.width === raster.width && size.height === raster.height) {
      return new Blob([blob], { type: 'image/jpeg' })
    }
    return await codec.encode(raster, size.width, size.height, 'image/jpeg', CHARACTER_JPEG_QUALITY)
  } finally {
    raster.close?.()
  }
}

/**
 * ページの参考画像を ref に向ける Patch（ページ root）。差し替えでは今の不透明度と表示を引き継ぐ
 */
export function referencePatch(page: Page, ref: string): Patch {
  const current = page.reference
  const value = current ? { ...current, ref } : { ref, opacity: 0.5, visible: true }
  return [{ op: 'add', path: '/reference', value }]
}

/** 画像の px で表した矩形 */
interface PixelRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * ページ全体に中央フィットした参考画像の上で、コマの `rect` が占める範囲を画像の px で返す。
 * 画像とページの縦横比が違えば、範囲は画像の外にはみ出す
 */
function referenceCrop(
  image: { width: number; height: number },
  pageSize: ProjectSettings['pageSize'],
  rect: Rect,
): PixelRect {
  // 画像 1px あたりのページの長さ。キャンバスの preserveAspectRatio="xMidYMid meet" と同じ
  const unit = Math.min(pageSize.w / image.width, pageSize.h / image.height)
  const pageW = pageSize.w / unit
  const pageH = pageSize.h / unit
  const offsetX = (pageW - image.width) / 2
  const offsetY = (pageH - image.height) / 2
  return {
    x: rect.x * pageW - offsetX,
    y: rect.y * pageH - offsetY,
    w: rect.w * pageW,
    h: rect.h * pageH,
  }
}

/**
 * 参考画像からコマの `rect` の範囲を切り抜いた PNG。画像の外は透明にする。
 * 寸法は `referenceCrop` の幅と高さを丸めたもの
 */
export async function cropReference(
  image: Blob,
  pageSize: ProjectSettings['pageSize'],
  rect: Rect,
  codec: ReferenceCodec = browserCodec,
): Promise<Blob> {
  const raster = await codec.decodeImage(image)
  try {
    const crop = referenceCrop(raster, pageSize, rect)
    const width = Math.max(1, Math.round(crop.w))
    const height = Math.max(1, Math.round(crop.h))
    const cropped: Raster = {
      width,
      height,
      draw: (ctx, w, h) => {
        ctx.save()
        ctx.scale(w / crop.w, h / crop.h)
        ctx.translate(-crop.x, -crop.y)
        raster.draw(ctx, raster.width, raster.height)
        ctx.restore()
      },
    }
    return await codec.encode(cropped, width, height, 'image/png', 1)
  } finally {
    raster.close?.()
  }
}

/** ドロップや貼り付けの DataTransfer から最初のファイル。無ければ undefined */
export function firstFile(data: DataTransfer | null): File | undefined {
  if (!data) return undefined
  for (const item of data.items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) return file
  }
  return data.files[0]
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context is unavailable')
  return { canvas, ctx }
}

const browserCodec: ReferenceCodec = {
  async decodeImage(blob) {
    const bitmap = await createImageBitmap(blob)
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
      close: () => bitmap.close(),
    }
  },
  async rasterizePdf(blob, maxSide) {
    // pdfjs は 1MB 近いので、PDF を読むときだけ取りに行く
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
    try {
      const doc = await task.promise
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) })
      const { canvas, ctx } = canvasOf(Math.round(viewport.width), Math.round(viewport.height))
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      return {
        width: canvas.width,
        height: canvas.height,
        draw: (target, w, h) => target.drawImage(canvas, 0, 0, w, h),
      }
    } finally {
      void task.destroy()
    }
  },
  async encode(raster, width, height, type, quality) {
    const { canvas, ctx } = canvasOf(width, height)
    if (type === 'image/jpeg') {
      // JPEG は透過を持てず、透明な画素が黒になるので先に白で塗る
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
    }
    raster.draw(ctx, width, height)
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error(m.web_reference_encode_failed()))),
        type,
        quality,
      ),
    )
  },
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest

  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const JPEG = [0xff, 0xd8, 0xff, 0xe0]
  const PDF = [...'%PDF-1.7'].map((c) => c.charCodeAt(0))
  const WEBP = [...'RIFF\0\0\0\0WEBP'].map((c) => c.charCodeAt(0))

  /** 先頭が magic で、全体が size バイトの Blob */
  const fileOf = (magic: number[], size = 64, type = '') => {
    const bytes = new Uint8Array(size)
    bytes.set(magic)
    return new Blob([bytes], { type })
  }

  /** デコード結果の寸法を決めておき、encode の呼び出しを記録する codec */
  function fakeCodec(image: { width: number; height: number }) {
    const calls = {
      decode: 0,
      pdf: [] as number[],
      encode: [] as [number, number, string, number][],
    }
    const raster = (w: number, h: number): Raster => ({ width: w, height: h, draw: () => {} })
    const codec: ReferenceCodec = {
      async decodeImage() {
        calls.decode++
        return raster(image.width, image.height)
      },
      async rasterizePdf(_, maxSide) {
        calls.pdf.push(maxSide)
        const scale = maxSide / Math.max(image.width, image.height)
        return raster(Math.round(image.width * scale), Math.round(image.height * scale))
      },
      async encode(_, width, height, type, quality) {
        calls.encode.push([width, height, type, quality])
        return new Blob([`${width}x${height}`], { type })
      },
    }
    return { codec, calls }
  }

  describe('toReferenceImage', () => {
    test('a PNG within the limit is stored as is', async () => {
      const { codec, calls } = fakeCodec({ width: 800, height: 600 })
      const png = fileOf(PNG)
      const out = await toReferenceImage(png, codec)
      expect(out.type).toBe('image/png')
      expect(out.size).toBe(png.size)
      expect(calls).toEqual({ decode: 1, pdf: [], encode: [] })
    })

    test('a JPEG is detected without a MIME type and keeps its format when shrunk', async () => {
      const { codec, calls } = fakeCodec({ width: 3000, height: 4000 })
      const out = await toReferenceImage(fileOf(JPEG), codec)
      expect(calls.encode).toEqual([[1536, 2048, 'image/jpeg', 0.92]])
      expect(out.type).toBe('image/jpeg')
    })

    test('a PDF is rasterized from its first page to a PNG with the long side 2048', async () => {
      const { codec, calls } = fakeCodec({ width: 595, height: 842 })
      const out = await toReferenceImage(fileOf(PDF, 64, 'application/pdf'), codec)
      expect(calls.pdf).toEqual([2048])
      expect(calls.decode).toBe(0)
      expect(calls.encode).toEqual([[1447, 2048, 'image/png', 0.92]])
      expect(out.type).toBe('image/png')
    })

    test('a WebP within the limit is stored as is, and a large one is shrunk to a PNG', async () => {
      const small = fakeCodec({ width: 800, height: 600 })
      const webp = fileOf(WEBP)
      const out = await toReferenceImage(webp, small.codec)
      expect(out.type).toBe('image/webp')
      expect(out.size).toBe(webp.size)
      expect(small.calls.encode).toEqual([])

      const large = fakeCodec({ width: 4096, height: 3072 })
      expect((await toReferenceImage(webp, large.codec)).type).toBe('image/png')
      expect(large.calls.encode).toEqual([[2048, 1536, 'image/png', 0.92]])
    })

    test('a RIFF file that is not a WebP is refused', async () => {
      const { codec } = fakeCodec({ width: 10, height: 10 })
      const wav = fileOf([...'RIFF\0\0\0\0WAVE'].map((c) => c.charCodeAt(0)))
      await expect(toReferenceImage(wav, codec)).rejects.toThrow('PNG、JPEG、WebP、PDF')
    })

    test('a 10MB image is shrunk to the long side 2048', async () => {
      const { codec, calls } = fakeCodec({ width: 8000, height: 6000 })
      await toReferenceImage(fileOf(PNG, 10 * 1024 * 1024), codec)
      expect(calls.encode).toEqual([[2048, 1536, 'image/png', 0.92]])
    })

    test('other formats are refused', async () => {
      const { codec } = fakeCodec({ width: 10, height: 10 })
      const gif = fileOf(
        [...'GIF89a'].map((c) => c.charCodeAt(0)),
        64,
        'image/gif',
      )
      await expect(toReferenceImage(gif, codec)).rejects.toThrow('PNG、JPEG、WebP、PDF')
    })
  })

  describe('toCharacterImage', () => {
    test('a PNG is shrunk to the long side 1024 and stored as a JPEG', async () => {
      const { codec, calls } = fakeCodec({ width: 1500, height: 2000 })
      const out = await toCharacterImage(fileOf(PNG), codec)
      expect(calls.encode).toEqual([[768, 1024, 'image/jpeg', 0.85]])
      expect(out.type).toBe('image/jpeg')
    })

    test('a small PNG is still re-encoded as a JPEG', async () => {
      const { codec, calls } = fakeCodec({ width: 384, height: 512 })
      await toCharacterImage(fileOf(PNG), codec)
      expect(calls.encode).toEqual([[384, 512, 'image/jpeg', 0.85]])
    })

    test('a JPEG within the limit is stored as is', async () => {
      const { codec, calls } = fakeCodec({ width: 600, height: 800 })
      const jpeg = fileOf(JPEG)
      const out = await toCharacterImage(jpeg, codec)
      expect(out.size).toBe(jpeg.size)
      expect(calls.encode).toEqual([])
    })

    test('a PDF is rasterized with the long side 1024', async () => {
      const { codec, calls } = fakeCodec({ width: 595, height: 842 })
      await toCharacterImage(fileOf(PDF), codec)
      expect(calls.pdf).toEqual([1024])
      expect(calls.encode).toEqual([[724, 1024, 'image/jpeg', 0.85]])
    })
  })

  test('fitLongSide keeps the aspect ratio and never enlarges', () => {
    expect(fitLongSide(4096, 1024)).toEqual({ width: 2048, height: 512 })
    expect(fitLongSide(100, 50)).toEqual({ width: 100, height: 50 })
  })

  describe('referencePatch', () => {
    const page: Page = { id: 'p', side: 'single', panels: [], scribbles: [] }

    test('a new reference is half transparent and visible', () => {
      expect(referencePatch(page, 'blob:a')).toEqual([
        { op: 'add', path: '/reference', value: { ref: 'blob:a', opacity: 0.5, visible: true } },
      ])
    })

    test('replacing keeps opacity and visibility', () => {
      const current = { ...page, reference: { ref: 'blob:a', opacity: 0.2, visible: false } }
      expect(referencePatch(current, 'blob:b')).toEqual([
        { op: 'add', path: '/reference', value: { ref: 'blob:b', opacity: 0.2, visible: false } },
      ])
    })
  })
}
