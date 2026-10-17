import type { ID, Page, Project } from '@manga/schema'
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  type PDFPage,
  type PDFRef,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib'
import { FONT_FAMILY, getBackend, loadFonts, type Surface } from './backend'
import { pagePixelSize } from './geometry'
import { drawPage } from './page'
import { alphabeticY, wrapHorizontal } from './text'
import type { RenderContext, RenderOptions } from './types'

export interface ExportPdfOptions extends RenderOptions {
  pages: 'all' | ID[]
  spread: boolean
  /** StorageAdapter.loadAsset を渡す。採用中の PanelArt を読むのに使う */
  loadAsset(ref: string): Promise<Blob>
  /** 1 ページ描き終えるごとに呼ぶ。done は描き終えたページ数、total は対象のページ数 */
  onProgress?(done: number, total: number): void
}

const PT_PER_MM = 72 / 25.4
/** 指示メモページの寸法。ページ幅に対する比率 */
const SHEET_FONT = 0.025
const SHEET_PAD = 0.08
// 先行ジョブ（描画、RGB 変換、deflate）の同時数。
// 増やすと、描画済みの 300dpi のサーフェス、getImageData の RGBA 複製、RGB バッファ、deflate 済みの XObject を抱えるメモリだけが増える
const RENDER_AHEAD = 3

interface Numbered {
  page: Page
  /** エピソード内のページ番号。1 始まり */
  number: number
}

/**
 * エピソードのページを renderPage と同じ描画で画像にして PDF に束ねる。
 * pages で範囲を絞り、spread なら見開き 1 枚にする（rtl は奇数ページが左、ltr は右）。
 * notes: 'sheet' なら各紙面の後ろに指示メモの一覧ページを足す。
 */
export async function exportPdf(
  project: Project,
  episodeId: ID,
  opts: ExportPdfOptions,
): Promise<Blob> {
  const episode = project.episodes.find((e) => e.id === episodeId)
  if (!episode) throw new Error(`episode ${episodeId} is not in the project`)
  const wanted = opts.pages === 'all' ? undefined : new Set(opts.pages)
  const targets: Numbered[] = episode.pages
    .map((page, i) => ({ page, number: i + 1 }))
    .filter(({ page }) => !wanted || wanted.has(page.id))

  const ctx: RenderContext = {
    settings: project.settings,
    characters: project.characters,
    loadAsset: opts.loadAsset,
  }
  const renderOpts: RenderOptions = {
    width: opts.width,
    notes: opts.notes,
    panelNumbers: opts.panelNumbers,
  }
  const pageHeight = project.settings.pageSize.h * PT_PER_MM
  const pageWidth = project.settings.pageSize.w * PT_PER_MM

  const doc = await PDFDocument.create()

  const renders = new Map<Numbered, Promise<{ page: Embedded; notes: Embedded[] }>>()
  const render = (t: Numbered) => {
    const index = targets.indexOf(t)
    for (const ahead of targets.slice(index, index + RENDER_AHEAD + 1)) {
      if (renders.has(ahead)) continue
      // RGB 変換と圧縮も先行側で済ませ、メインの待ちを PDF への配置だけにする
      const job = Promise.all([
        drawPage(ahead.page, ctx, renderOpts).then((surface) => embedOpaque(doc, surface)),
        (opts.notes === 'sheet'
          ? renderNotesSheets(ahead.page, ahead.number, ctx, opts.width)
          : Promise.resolve([])
        ).then((surfaces) => Promise.all(surfaces.map((surface) => embedOpaque(doc, surface)))),
      ]).then(([page, notes]) => ({ page, notes }))
      // 先に描き始めた分が、手前のページの失敗で待たれないまま reject しても未処理にしない
      job.catch(() => undefined)
      renders.set(ahead, job)
    }
    return renders.get(t) as Promise<{ page: Embedded; notes: Embedded[] }>
  }

  let done = 0
  for (const group of groupSheets(targets, opts.spread)) {
    const images: { image: Embedded; leftHalf: boolean }[] = []
    const notes: Embedded[] = []
    for (const t of group) {
      const rendered = await render(t)
      renders.delete(t)
      notes.push(...rendered.notes)
      const image = rendered.page
      images.push({ image, leftHalf: onLeftHalf(t.number, project.settings.direction) })
      opts.onProgress?.(++done, targets.length)
    }
    // notes: 'margin' の余白で画像が pageSize より横に長くなるので、幅は画像から決める
    const halfWidth = Math.max(
      ...images.map(({ image }) => (image.width / image.height) * pageHeight),
    )
    const sheet = doc.addPage([opts.spread ? halfWidth * 2 : halfWidth, pageHeight])
    for (const { image, leftHalf } of images) {
      const w = (image.width / image.height) * pageHeight
      const x = !opts.spread ? 0 : leftHalf ? halfWidth - w : halfWidth
      drawEmbedded(sheet, image, { x, y: 0, width: w, height: pageHeight })
    }
    for (const image of notes) {
      drawEmbedded(doc.addPage([pageWidth, pageHeight]), image, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      })
    }
  }
  const bytes = await doc.save()
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
}

interface Embedded {
  ref: PDFRef
  width: number
  height: number
}

/**
 * 不透明な Surface を RGB の画像 XObject として埋め込む。アルファは捨てる（背景は白で塗りつぶし済み）。
 * pdf-lib の embedPng を使わないのは、PNG の展開と再圧縮を JS（pako）でやるので 300dpi 1 枚に 200ms 前後かかり、
 * 20 ページ 10 秒に収まらないため。PNG も経由せず、画素を直接取り出して CompressionStream でネイティブに圧縮する
 */
async function embedOpaque(doc: PDFDocument, surface: Surface): Promise<Embedded> {
  const { width, height } = surface
  const rgba = surface.ctx.getImageData(0, 0, width, height).data
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i] as number
    rgb[j + 1] = rgba[i + 1] as number
    rgb[j + 2] = rgba[i + 2] as number
  }
  const deflated = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))
  const data = new Uint8Array(await new Response(deflated).arrayBuffer())
  const stream = doc.context.stream(data, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
    Filter: 'FlateDecode',
  })
  return { ref: doc.context.register(stream), width, height }
}

function drawEmbedded(
  page: PDFPage,
  image: Embedded,
  box: { x: number; y: number; width: number; height: number },
): void {
  const name = page.node.newXObject('Image', image.ref)
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(box.width, 0, 0, box.height, box.x, box.y),
    drawObject(name),
    popGraphicsState(),
  )
}

/** 紙面ごとのページ。見開きでは偶数ページとその次の奇数ページを組にし（1 ページ目は単独）、相方が範囲外なら片側だけ */
function groupSheets(targets: Numbered[], spread: boolean): Numbered[][] {
  if (!spread) return targets.map((t) => [t])
  const groups: Numbered[][] = []
  for (const t of targets) {
    const last = groups.at(-1)
    const partner = last?.length === 1 && last[0] ? last[0] : undefined
    if (partner && partner.number % 2 === 0 && partner.number + 1 === t.number) last?.push(t)
    else groups.push([t])
  }
  return groups
}

/** 見開きで左半分に来るか。右綴じ（rtl）は奇数ページが左、左綴じは偶数ページが左 */
function onLeftHalf(number: number, direction: Project['settings']['direction']): boolean {
  return (number % 2 === 1) === (direction === 'rtl')
}

/**
 * ページ 1 枚分の指示メモ（コマ番号、camera、note、セリフ）を横書きで並べた Surface。収まらなければ複数枚。
 * pdf-lib に Noto Sans JP を埋め込んで文字で書かないのは、@pdf-lib/fontkit のサブセット化で字が欠け、
 * サブセットしないと PDF ごとに約 6MB 増えるうえ可変フォントの既定の太さ（Thin）になるため
 */
async function renderNotesSheets(
  page: Page,
  number: number,
  ctx: RenderContext,
  width: number | undefined,
): Promise<Surface[]> {
  const [backend] = await Promise.all([getBackend(), loadFonts()])
  const size = pagePixelSize(ctx.settings, width)
  const fontPx = size.w * SHEET_FONT
  const lineHeight = fontPx * 1.6
  const pad = size.w * SHEET_PAD
  const names = new Map(ctx.characters.map((c) => [c.id, c.name]))

  const blocks: { text: string; indent: number; bold?: boolean }[] = [
    { text: `p.${number}`, indent: 0, bold: true },
  ]
  for (const panel of [...page.panels].sort((a, b) => a.order - b.order)) {
    blocks.push({ text: '', indent: 0 })
    blocks.push({
      text: [String(panel.order), panel.camera && `[${panel.camera}]`].filter(Boolean).join('  '),
      indent: 0,
      bold: true,
    })
    if (panel.note) blocks.push({ text: panel.note, indent: 1 })
    for (const bubble of [...panel.bubbles].sort((a, b) => a.order - b.order)) {
      const speaker = bubble.speakerId ? names.get(bubble.speakerId) : undefined
      blocks.push({ text: `${speaker ?? '—'}「${bubble.text}」`, indent: 1 })
    }
  }

  const surfaces: ReturnType<typeof backend.createSurface>[] = []
  const newSurface = () => {
    const surface = backend.createSurface(size.w, size.h)
    surface.ctx.fillStyle = '#fff'
    surface.ctx.fillRect(0, 0, size.w, size.h)
    surface.ctx.fillStyle = '#000'
    surface.ctx.textAlign = 'left'
    surface.ctx.textBaseline = 'alphabetic'
    surfaces.push(surface)
    return surface
  }
  let c = newSurface().ctx
  let y = pad
  for (const { text, indent, bold } of blocks) {
    const x = pad + indent * fontPx * 2
    c.font = `${bold ? 'bold ' : ''}${fontPx}px "${FONT_FAMILY}"`
    for (const line of wrapHorizontal(c, text, size.w - pad - x)) {
      if (y + lineHeight > size.h - pad) {
        const font = c.font
        c = newSurface().ctx
        c.font = font
        y = pad
      }
      c.fillText(line, x, alphabeticY(y, fontPx, 'top'))
      y += lineHeight
    }
  }
  return surfaces
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const { readFile } = await import('node:fs/promises')

  const base = fixtures.samplePage01
  const episode = base.episodes[0]
  if (!episode) throw new Error('fixture has no episode')
  const template = episode.pages[0] as Page
  // base を import.meta.url のまま渡すと、このブロックが本番ビルドで消える前に Vite がディレクトリを資産として探して警告する
  const artDir = new URL('../../../docs/fixtures/art/', String(import.meta.url))

  /** フィクスチャのページを n 枚に複製し、全コマに docs/fixtures/art の画像を採用させる */
  const projectOf = (n: number, direction = base.settings.direction): Project => ({
    ...base,
    settings: { ...base.settings, direction },
    episodes: [
      {
        ...episode,
        pages: Array.from({ length: n }, (_, i) => ({
          ...template,
          id: `pg_${i + 1}`,
          panels: template.panels.map((panel, j) => ({
            ...panel,
            artId: `art_${panel.id}`,
            arts: [
              {
                id: `art_${panel.id}`,
                ref: `pn_${(j % 3) + 1}.png`,
                provider: 'fake',
                prompt: '',
                createdAt: '2026-10-15T00:00:00.000Z',
              },
            ],
          })),
        })),
      },
    ],
  })

  const loaded: string[] = []
  const loadAsset = async (ref: string) => {
    loaded.push(ref)
    return new Blob([new Uint8Array(await readFile(new URL(ref, artDir)))])
  }
  const opts = (o: Partial<ExportPdfOptions> = {}): ExportPdfOptions => ({
    width: 364,
    notes: 'none',
    panelNumbers: true,
    pages: 'all',
    spread: false,
    loadAsset,
    ...o,
  })
  const reload = async (blob: Blob) => PDFDocument.load(new Uint8Array(await blob.arrayBuffer()))

  test('全ページを 1 枚ずつ束ね、採用中の画像を読み、進捗を返す', async () => {
    loaded.length = 0
    const progress: [number, number][] = []
    const pdf = await reload(
      await exportPdf(
        projectOf(3),
        episode.id,
        opts({ onProgress: (d, t) => progress.push([d, t]) }),
      ),
    )
    expect(pdf.getPageCount()).toBe(3)
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    expect(new Set(loaded)).toEqual(new Set(['pn_1.png', 'pn_2.png', 'pn_3.png']))
    const [w, h] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()]
    expect(w / h).toBeCloseTo(base.settings.pageSize.w / base.settings.pageSize.h, 2)
  })

  test('pages で指定したページだけを、エピソードの順に出す', async () => {
    const progress: number[] = []
    const pdf = await reload(
      await exportPdf(
        projectOf(4),
        episode.id,
        opts({ pages: ['pg_4', 'pg_2'], onProgress: (_, t) => progress.push(t) }),
      ),
    )
    expect(pdf.getPageCount()).toBe(2)
    expect(progress).toEqual([2, 2])
  })

  test('見開きは偶数ページと次の奇数ページを組にし、相方が範囲外なら片側だけ', () => {
    const n = (...numbers: number[]) => numbers.map((number) => ({ page: template, number }))
    const numbers = (groups: Numbered[][]) => groups.map((g) => g.map((t) => t.number))
    expect(numbers(groupSheets(n(1, 2, 3, 4, 5), true))).toEqual([[1], [2, 3], [4, 5]])
    expect(numbers(groupSheets(n(2, 3, 5, 6), true))).toEqual([[2, 3], [5], [6]])
    expect(numbers(groupSheets(n(1, 2), false))).toEqual([[1], [2]])
  })

  test('右綴じは奇数ページが左、左綴じは奇数ページが右', () => {
    expect([1, 2].map((p) => onLeftHalf(p, 'rtl'))).toEqual([true, false])
    expect([1, 2].map((p) => onLeftHalf(p, 'ltr'))).toEqual([false, true])
  })

  test('spread: true は見開きを倍幅の 1 枚にする', async () => {
    const pdf = await reload(
      await exportPdf(projectOf(3, 'rtl'), episode.id, opts({ spread: true })),
    )
    expect(pdf.getPageCount()).toBe(2)
    const single =
      (364 / Math.round((364 * base.settings.pageSize.h) / base.settings.pageSize.w)) *
      base.settings.pageSize.h *
      PT_PER_MM
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(single * 2, 0)
    expect(pdf.getPage(1).getWidth()).toBeCloseTo(single * 2, 0)
  })

  test("notes: 'sheet' は各ページの後ろに指示メモページを足す", async () => {
    const blob = await exportPdf(projectOf(2), episode.id, opts({ notes: 'sheet' }))
    const pdf = await reload(blob)
    expect(pdf.getPageCount()).toBe(4)
    if (process.env.PDF_OUT) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(process.env.PDF_OUT, new Uint8Array(await blob.arrayBuffer()))
    }
  })

  // 共有ランナーの CPU で所要時間がぶれ、コードと無関係に落ちるので、PERF=1（mise run perf）のときだけ測る
  test.runIf(process.env.PERF)('300dpi の 20 ページが 10 秒以内', { timeout: 30_000 }, async () => {
    const project = projectOf(20)
    // フォント登録とバックエンドの初期化は 1 回だけなので、計測から外す
    await exportPdf(project, episode.id, opts({ width: undefined, pages: ['pg_1'] }))
    const started = performance.now()
    const blob = await exportPdf(project, episode.id, opts({ width: undefined, notes: 'sheet' }))
    const elapsed = performance.now() - started
    expect((await reload(blob)).getPageCount()).toBe(40)
    expect(elapsed).toBeLessThan(10_000)
  })
}
