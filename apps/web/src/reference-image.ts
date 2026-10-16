import type { Page, Patch } from '@manga/schema'

/** 参考画像を保存するときの長辺の上限（px）。大きな画像でキャンバス操作が重くならないよう読み込み時に縮める */
export const REFERENCE_MAX_SIDE = 2048

export type ReferenceFormat = 'png' | 'jpeg' | 'pdf'

/** 描ける画像。`draw` は (0, 0) から width × height に引き伸ばして描く */
export interface Raster {
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
  encode(raster: Raster, width: number, height: number, type: string): Promise<Blob>
}

/**
 * 先頭のバイトで形式を判定する。クリップボードやドロップの File は MIME が空のことがあるので、
 * `blob.type` には頼らない。対応外は null
 */
export async function sniffFormat(blob: Blob): Promise<ReferenceFormat | null> {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  const starts = (bytes: number[]) => bytes.every((b, i) => head[i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (starts([0xff, 0xd8, 0xff])) return 'jpeg'
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'
  return null
}

/** アスペクト比を保って長辺を maxSide 以下にした整数の寸法。小さい画像は拡大しない */
export function fitLongSide(
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

/**
 * PNG / JPEG / PDF を保存用の画像にする。PDF は 1 ページ目を PNG に、長辺が
 * REFERENCE_MAX_SIDE を超える画像は縮めて同じ形式にする。収まっている PNG / JPEG はそのまま返す。
 * 対応外の形式は throw する
 */
export async function toReferenceImage(
  blob: Blob,
  codec: ReferenceCodec = browserCodec,
): Promise<Blob> {
  const format = await sniffFormat(blob)
  if (format === null) throw new Error('PNG、JPEG、PDF のいずれかを選んでください')
  const raster =
    format === 'pdf'
      ? await codec.rasterizePdf(blob, REFERENCE_MAX_SIDE)
      : await codec.decodeImage(blob)
  try {
    const size = fitLongSide(raster.width, raster.height)
    const type = format === 'jpeg' ? 'image/jpeg' : 'image/png'
    if (format !== 'pdf' && size.width === raster.width && size.height === raster.height) {
      return new Blob([blob], { type })
    }
    return await codec.encode(raster, size.width, size.height, type)
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
  async encode(raster, width, height, type) {
    const { canvas, ctx } = canvasOf(width, height)
    raster.draw(ctx, width, height)
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('画像を書き出せませんでした'))),
        type,
        0.92,
      ),
    )
  },
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest

  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const JPEG = [0xff, 0xd8, 0xff, 0xe0]
  const PDF = [...'%PDF-1.7'].map((c) => c.charCodeAt(0))

  /** 先頭が magic で、全体が size バイトの Blob */
  const fileOf = (magic: number[], size = 64, type = '') => {
    const bytes = new Uint8Array(size)
    bytes.set(magic)
    return new Blob([bytes], { type })
  }

  /** デコード結果の寸法を決めておき、encode の呼び出しを記録する codec */
  function fakeCodec(image: { width: number; height: number }) {
    const calls = { decode: 0, pdf: [] as number[], encode: [] as [number, number, string][] }
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
      async encode(_, width, height, type) {
        calls.encode.push([width, height, type])
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
      expect(calls.encode).toEqual([[1536, 2048, 'image/jpeg']])
      expect(out.type).toBe('image/jpeg')
    })

    test('a PDF is rasterized from its first page to a PNG with the long side 2048', async () => {
      const { codec, calls } = fakeCodec({ width: 595, height: 842 })
      const out = await toReferenceImage(fileOf(PDF, 64, 'application/pdf'), codec)
      expect(calls.pdf).toEqual([2048])
      expect(calls.decode).toBe(0)
      expect(calls.encode).toEqual([[1447, 2048, 'image/png']])
      expect(out.type).toBe('image/png')
    })

    test('a 10MB image is shrunk to the long side 2048', async () => {
      const { codec, calls } = fakeCodec({ width: 8000, height: 6000 })
      await toReferenceImage(fileOf(PNG, 10 * 1024 * 1024), codec)
      expect(calls.encode).toEqual([[2048, 1536, 'image/png']])
    })

    test('other formats are refused', async () => {
      const { codec } = fakeCodec({ width: 10, height: 10 })
      const gif = fileOf(
        [...'GIF89a'].map((c) => c.charCodeAt(0)),
        64,
        'image/gif',
      )
      await expect(toReferenceImage(gif, codec)).rejects.toThrow('PNG、JPEG、PDF')
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
