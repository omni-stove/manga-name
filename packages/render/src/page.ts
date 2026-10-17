import { currentArt, type Page, type Panel, panelOutline } from '@manga/schema'
import { getBackend, loadFonts, type Surface } from './backend'
import { bubbleGeometry, drawBubble, textBox } from './bubble'
import { type PxRect, pagePixelSize, pointToPx, rectToPx } from './geometry'
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

/** 採用中の生成画像を読んでデコードする。無ければ undefined */
async function loadArt(panel: Panel, ctx: RenderContext): Promise<CanvasImageSource | undefined> {
  const art = currentArt(panel)
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
  return (await drawPage(page, ctx, opts)).toPng()
}

/** renderPage が PNG にする前の Surface。PNG を経由せず画素を使う呼び出し側（exportPdf）向け */
export async function drawPage(
  page: Page,
  ctx: RenderContext,
  opts: RenderOptions,
): Promise<Surface> {
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
    const outline = panelOutline(panel).map((p) => pointToPx(p, pageRect))
    const image = arts[i]
    if (image) drawCover(c, image, rect, outline)
    else drawPlaceholder(c, panel, rect, outline, pageSize.w * NOTE_FONT)
    drawFrame(c, outline, pageSize.w * FRAME_WIDTH)
    if (opts.panelNumbers) {
      drawPanelNumber(c, panel.order, outline, pageSize.w * NOTE_FONT * 1.5)
    }
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

  return surface
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const { readFile } = await import('node:fs/promises')

  const project = fixtures.samplePage01
  const emptyPage = project.episodes[0]?.pages[0] as Page
  // base を import.meta.url のまま渡すと、このブロックが本番ビルドで消える前に Vite がディレクトリを資産として探して警告する
  const artDir = new URL('../../../docs/fixtures/art/', String(import.meta.url))

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

  const pixels = async (png: Blob) => {
    const backend = await getBackend()
    const image = await backend.decodeImage(png)
    const { width, height } = image as { width: number; height: number }
    const probe = backend.createSurface(width, height)
    probe.ctx.drawImage(image, 0, 0)
    return { width, height, data: probe.ctx.getImageData(0, 0, width, height).data }
  }

  // toMatchFileSnapshot は文字列しか raw で保存せず、PNG のバイト列は OS ごとの圧縮と
  // 文字のラスタライズの丸め（チャンネル差 1）で変わるので、デコードした画素を許容差つきで比べる。
  // 無ければ書いて通す（CI では失敗）。更新はファイルを消して再実行する
  const PIXEL_TOLERANCE = 2
  const matchPngSnapshot = async (name: string, png: Blob) => {
    const { writeFile } = await import('node:fs/promises')
    const file = new URL(`./__snapshots__/${name}.png`, import.meta.url)
    const expected = await readFile(file).catch(() => undefined)
    if (expected === undefined) {
      if (process.env.CI) throw new Error(`snapshot ${name}.png is missing`)
      await writeFile(file, await bytes(png))
      return
    }
    const received = await pixels(png)
    const stored = await pixels(new Blob([new Uint8Array(expected)]))
    expect([received.width, received.height]).toEqual([stored.width, stored.height])
    let worst = 0
    for (let i = 0; i < received.data.length; i++) {
      worst = Math.max(worst, Math.abs((received.data[i] ?? 0) - (stored.data[i] ?? 0)))
    }
    const hint = `snapshot ${name}.png differs. Delete the file and rerun to update it`
    expect(worst, hint).toBeLessThanOrEqual(PIXEL_TOLERANCE)
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

  test('多角形のコマは輪郭で絵を切り、枠も輪郭に沿って引く', async () => {
    const { page, ctx } = withArts()
    const [pn1, ...rest] = page.panels as [Panel, ...Panel[]]
    // pn_1 を右上から左下への斜めの線で割った 2 つの台形
    const shaped: Page = {
      ...page,
      panels: [
        {
          ...pn1,
          rect: { x: 0.41, y: 0, w: 0.59, h: 0.26 },
          shape: [
            { x: 0.322, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        },
        {
          ...pn1,
          id: 'pn_1b',
          order: 7,
          bubbles: [],
          focusPoints: [],
          vectors: [],
          rect: { x: 0, y: 0, w: 0.59, h: 0.26 },
          shape: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0.678, y: 1 },
            { x: 0, y: 1 },
          ],
        },
        ...rest,
      ],
    }
    const png = await renderPage(shaped, ctx, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: true,
    })
    await matchPngSnapshot('page-shaped', png)
  })

  test('同じ入力で 2 回描くとバイト一致する', async () => {
    const { page, ctx } = withArts()
    const opts: RenderOptions = { width: SNAPSHOT_WIDTH, notes: 'margin', panelNumbers: true }
    const a = await bytes(await renderPage(page, ctx, opts))
    const b = await bytes(await renderPage(page, ctx, opts))
    expect(a.equals(b)).toBe(true)
  })

  // 共有ランナーの CPU で所要時間がぶれ、コードと無関係に落ちるので、PERF=1（mise run perf）のときだけ測る
  test.runIf(process.env.PERF)('300dpi の 1 ページが 500ms 以内', async () => {
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
