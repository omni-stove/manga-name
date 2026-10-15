import type { Page, Panel } from '@manga/schema'
import { getBackend, loadFonts } from './backend'
import { bubbleGeometry, drawBubble, textBox } from './bubble'
import { type PxRect, pagePixelSize, rectToPx } from './geometry'
import { drawCover, drawFrame, drawNotesMargin, drawPanelNumber, drawPlaceholder } from './panel'
import { drawVerticalText, layoutBubbleText } from './text'
import type { RenderContext, RenderOptions } from './types'

/** ページ幅に対する比率 */
const FRAME_WIDTH = 0.003
const BUBBLE_LINE_WIDTH = 0.002
const MIN_FONT = 0.012
const NOTE_FONT = 0.012
const MARGIN_FONT = 0.014
const NOTES_MARGIN = 0.15

function byOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order)
}

/** 採用中の生成画像を読んでデコードする。artId が無ければ undefined */
async function loadArt(panel: Panel, ctx: RenderContext): Promise<CanvasImageSource | undefined> {
  const art = panel.arts.find((a) => a.id === panel.artId)
  if (!art) return undefined
  const backend = await getBackend()
  return backend.decodeImage(await ctx.loadAsset(art.ref))
}

/**
 * ページ 1 枚を PNG に合成する。同じ Page と同じアセットからは同じバイト列が出る。
 * 焦点、ベクトル、診断、参考画像、手描きは描かない。
 */
export async function renderPage(
  page: Page,
  ctx: RenderContext,
  opts: RenderOptions,
): Promise<Blob> {
  const [backend] = await Promise.all([getBackend(), loadFonts()])
  const pageSize = pagePixelSize(ctx.settings, opts.width)
  const margin = opts.notes === 'margin' ? Math.round(pageSize.w * NOTES_MARGIN) : 0
  const marginOnLeft = ctx.settings.direction === 'ltr'
  const surface = backend.createSurface(pageSize.w + margin, pageSize.h)
  const c = surface.ctx
  const pageRect: PxRect = { x: marginOnLeft ? margin : 0, y: 0, w: pageSize.w, h: pageSize.h }

  c.fillStyle = '#fff'
  c.fillRect(0, 0, surface.width, surface.height)

  const panels = byOrder(page.panels)
  const arts = await Promise.all(panels.map((panel) => loadArt(panel, ctx)))

  panels.forEach((panel, i) => {
    const rect = rectToPx(panel.rect, pageRect)
    const image = arts[i]
    if (image) drawCover(c, image, rect)
    else drawPlaceholder(c, panel, rect, pageSize.w * NOTE_FONT)
    drawFrame(c, rect, pageSize.w * FRAME_WIDTH)
    if (opts.panelNumbers) drawPanelNumber(c, panel.order, rect, pageSize.w * NOTE_FONT * 1.5)
  })

  for (const panel of panels) {
    const rect = rectToPx(panel.rect, pageRect)
    for (const bubble of byOrder(panel.bubbles)) {
      const g = bubbleGeometry(bubble, rect)
      drawBubble(c, bubble.shape, g, pageSize.w * BUBBLE_LINE_WIDTH)
      const box = textBox(bubble.shape, g)
      const { lines, fontPx } = layoutBubbleText(bubble.text, box, pageSize.w * MIN_FONT)
      drawVerticalText(c, lines, fontPx, box)
    }
  }

  if (margin > 0) {
    const area: PxRect = { x: marginOnLeft ? 0 : pageSize.w, y: 0, w: margin, h: pageSize.h }
    drawNotesMargin(c, panels, area, pageSize.w * MARGIN_FONT)
  }

  return surface.toPng()
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const { readFile } = await import('node:fs/promises')

  const project = fixtures.samplePage01
  const emptyPage = project.episodes[0]?.pages[0] as Page
  const artDir = new URL('../../../docs/fixtures/art/', import.meta.url)

  const noAssets: RenderContext = {
    settings: project.settings,
    characters: project.characters,
    loadAsset: () => Promise.reject(new Error('no assets')),
  }

  const withArts = (): { page: Page; ctx: RenderContext } => ({
    page: {
      ...emptyPage,
      panels: emptyPage.panels.map((panel) => ({
        ...panel,
        artId: `art_${panel.id}`,
        arts: [
          {
            id: `art_${panel.id}`,
            ref: `file:${panel.id}.png`,
            provider: 'fake',
            prompt: '',
            createdAt: '2026-10-15T00:00:00.000Z',
          },
        ],
      })),
    },
    ctx: {
      ...noAssets,
      loadAsset: async (ref) =>
        new Blob([new Uint8Array(await readFile(new URL(ref.replace(/^file:/, ''), artDir)))]),
    },
  })

  const bytes = async (blob: Blob) => Buffer.from(await blob.arrayBuffer())

  // toMatchFileSnapshot は文字列しか raw で保存しないので、PNG は自前で比較する。
  // 無ければ書いて通す（CI では失敗）。更新はファイルを消して再実行する
  const matchPngSnapshot = async (name: string, png: Blob) => {
    const { writeFile } = await import('node:fs/promises')
    const file = new URL(`./__snapshots__/${name}.png`, import.meta.url)
    const received = await bytes(png)
    const expected = await readFile(file).catch(() => undefined)
    if (expected === undefined) {
      if (process.env.CI) throw new Error(`snapshot ${name}.png is missing`)
      await writeFile(file, received)
      return
    }
    if (!expected.equals(received)) {
      throw new Error(`snapshot ${name}.png differs. Delete the file and rerun to update it`)
    }
  }

  const SNAPSHOT_WIDTH = 728

  test('arts が空のフィクスチャ: 6 コマの枠とフキダシ 3 つとセリフ', async () => {
    const png = await renderPage(emptyPage, noAssets, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: true,
    })
    expect(png.type).toBe('image/png')
    await matchPngSnapshot('page-empty', png)
  })

  test('arts にフィクスチャ画像を入れたページ', async () => {
    const { page, ctx } = withArts()
    const png = await renderPage(page, ctx, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: true,
    })
    await matchPngSnapshot('page-arts', png)
  })

  test("notes: 'margin' は右に余白を足す", async () => {
    const png = await renderPage(emptyPage, noAssets, {
      width: SNAPSHOT_WIDTH,
      notes: 'margin',
      panelNumbers: false,
    })
    await matchPngSnapshot('page-margin', png)
  })

  test('同じ入力で 2 回描くとバイト一致する', async () => {
    const { page, ctx } = withArts()
    const opts: RenderOptions = { width: SNAPSHOT_WIDTH, notes: 'margin', panelNumbers: true }
    const a = await bytes(await renderPage(page, ctx, opts))
    const b = await bytes(await renderPage(page, ctx, opts))
    expect(a.equals(b)).toBe(true)
  })

  test('300dpi の 1 ページが 500ms 以内', async () => {
    const opts: RenderOptions = { notes: 'none', panelNumbers: true }
    // フォント登録とバックエンドの初期化は 1 回だけなので、計測から外す
    await renderPage(emptyPage, noAssets, opts)
    const started = performance.now()
    const png = await renderPage(emptyPage, noAssets, opts)
    const elapsed = performance.now() - started
    expect(png.size).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(500)
  })
}
