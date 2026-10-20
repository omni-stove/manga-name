import {
  type Bubble,
  blackPanel,
  bubbleOutline,
  bubbleTextBox,
  bubbleTypeface,
  clipTextBox,
  currentArt,
  effectInk,
  effectLines,
  type FocusPoint,
  frameOutline,
  groundColor,
  hasFrameLine,
  innerFrameOf,
  OVERLAY_COLORS,
  type Page,
  type Panel,
  paintOrder,
  panelOutline,
  panelTone,
  SFX_OUTLINE,
  sfxFontSize,
  sfxLetterings,
  sfxTypeface,
  TONE_MATRICES,
} from '@manga/schema'
import { getBackend, loadFonts } from './backend'
import { bubbleGeometry, drawBubble } from './bubble'
import { type PxRect, pagePixelSize, pointToPx, rectToPx } from './geometry'
import {
  actingNotes,
  applyColorMatrix,
  drawCover,
  drawEffectLines,
  drawFrame,
  drawNotesMargin,
  drawPanelNumber,
  drawPlaceholder,
  drawSoftEdge,
  fillOutline,
  withClip,
} from './panel'
import {
  drawHorizontalText,
  drawVerticalText,
  layoutBubbleText,
  measuredAdvance,
  unbrokenLines,
} from './text'
import type { RenderContext, RenderOptions, Surface } from './types'

/** 1 ページの幅に対する比率。見開きでも 1 ページ分の幅に対してとり、線と文字を 1 ページのときと同じ太さにする */
const FRAME_WIDTH = 0.003
const BUBBLE_LINE_WIDTH = 0.002
const MIN_FONT = 0.012
const NOTE_FONT = 0.012
const MARGIN_FONT = 0.014
const NOTES_MARGIN = 0.15

function byOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order)
}

/** 採用中の生成画像を読んでデコードし、コマの色調 tone（panelTone で決めたもの）を掛ける。無ければ undefined */
async function loadArt(
  panel: Panel,
  ctx: RenderContext,
  tone: Page['tone'],
): Promise<CanvasImageSource | undefined> {
  const art = currentArt(panel)
  if (!art) return undefined
  const backend = await getBackend()
  const image = await backend.decodeImage(await ctx.loadAsset(art.ref))
  if (tone === undefined) return image
  const { width, height } = image as { width: number; height: number }
  const toned = backend.createSurface(width, height)
  toned.ctx.drawImage(image, 0, 0)
  const pixels = toned.ctx.getImageData(0, 0, width, height)
  applyColorMatrix(pixels.data, TONE_MATRICES[tone])
  toned.ctx.putImageData(pixels, 0, 0)
  return toned.ctx.canvas as CanvasImageSource
}

/**
 * ページ 1 枚を PNG に合成する。同じ Page と同じアセットからは同じバイト列が出る。
 * sfx の焦点の label は、絵の上、フキダシと枠線の下に、コマの輪郭で切った描き文字として、焦点ごとの傾き・書体・大きさで描く。
 * 紙面全体に重ねるトーンは、フキダシと間白まで描いた後に乗算で重ねる。
 * face と keyObject の焦点、ベクトル、診断、参考画像、手描きは描かない。
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
  const typefaces = page.panels.flatMap((panel) => [
    ...panel.bubbles.map(bubbleTypeface),
    ...sfxLetterings(panel).map(sfxTypeface),
  ])
  const [backend] = await Promise.all([getBackend(), loadFonts(typefaces)])
  const unit = pagePixelSize(ctx.settings, opts.width)
  const pageSize = page.spread ? { w: unit.w * 2, h: unit.h } : unit
  const margin = opts.notes === 'margin' ? Math.round(unit.w * NOTES_MARGIN) : 0
  const marginOnLeft = ctx.settings.direction === 'ltr'
  const surface = backend.createSurface(pageSize.w + margin, pageSize.h)
  const c = surface.ctx
  const pageRect: PxRect = { x: marginOnLeft ? margin : 0, y: 0, w: pageSize.w, h: pageSize.h }

  // 指示メモの余白は紙の地によらず白
  c.fillStyle = '#fff'
  c.fillRect(0, 0, surface.width, surface.height)
  const ground = groundColor(page)
  c.fillStyle = ground
  c.fillRect(pageRect.x, pageRect.y, pageRect.w, pageRect.h)

  const innerRect = rectToPx(innerFrameOf(page), pageRect)
  const panels = paintOrder(page.panels)
  const arts = await Promise.all(panels.map((panel) => loadArt(panel, ctx, panelTone(page, panel))))
  // 黒い地のコマと、黒い紙の上の枠なしのコマは、中が黒い
  const blackInside = (panel: Panel) =>
    blackPanel(panel) || (panel.frame === 'none' && ground === '#000')
  const drawBubbles = (panel: Panel, overflow: boolean) => {
    const rect = rectToPx(panel.rect, pageRect)
    for (const bubble of byOrder(panel.bubbles)) {
      if ((bubble.overflow === true) !== overflow) continue
      const g = bubbleGeometry(bubble, rect)
      drawBubble(c, bubble.shape, g, unit.w * BUBBLE_LINE_WIDTH, bubble.fill)
      const text = bubbleTextBox(bubble.shape, g)
      const box = clipTextBox(overflow ? text : clipTextBox(text, rect), innerRect)
      // 地を持たないフキダシのセリフは黒塗りの上で見えないので白抜きにする。はみ出す方は白い紙にかかるので黒のまま
      const white = bubbleOutline(bubble.shape, g).fill
        ? bubble.fill === 'black'
        : !overflow && blackInside(panel)
      const color = white ? '#fff' : '#000'
      const typeface = bubbleTypeface(bubble)
      const minPx = unit.w * MIN_FONT
      if (bubble.writing === 'horizontal') {
        const advance = measuredAdvance(c, typeface)
        const laid = layoutBubbleText(bubble.text, box, minPx, 'horizontal', advance)
        drawHorizontalText(c, laid.lines, laid.fontPx, box, color, typeface, advance)
      } else {
        const { lines, fontPx } = layoutBubbleText(bubble.text, box, minPx)
        drawVerticalText(c, lines, fontPx, box, color, typeface)
      }
    }
  }

  const drawSfx = (panel: Panel) => {
    const rect = rectToPx(panel.rect, pageRect)
    for (const focus of sfxLetterings(panel)) {
      const fontPx = sfxFontSize(focus, rect.w, rect.h)
      const center = pointToPx(focus.pos, rect)
      c.save()
      c.translate(center.x, center.y)
      c.rotate(((focus.rotation ?? 0) * Math.PI) / 180)
      drawVerticalText(
        c,
        unbrokenLines(focus.label),
        fontPx,
        { x: 0, y: 0, w: 0, h: 0 },
        '#000',
        sfxTypeface(focus),
        { color: '#fff', width: fontPx * SFX_OUTLINE },
      )
      c.restore()
    }
  }

  panels.forEach((panel, i) => {
    const rect = rectToPx(panel.rect, pageRect)
    const outline = frameOutline(
      panelOutline(panel).map((p) => pointToPx(p, pageRect)),
      panel.frame,
      unit.w,
    )
    const image = arts[i]
    // 枠ありのコマは、下に敷いた枠なしのコマの絵を隠すよう白い地を持つ
    if (blackPanel(panel)) fillOutline(c, outline, '#000')
    else if (panel.frame !== 'none') fillOutline(c, outline, '#fff')
    if (image) drawCover(c, image, rect, outline)
    else if (panel.fill === undefined) {
      const ink = blackInside(panel) ? '#fff' : '#000'
      drawPlaceholder(c, panel, rect, outline, unit.w * NOTE_FONT, ink)
    }
    drawEffectLines(c, outline, effectLines(panel, rect, unit.w), effectInk(panel))
    // フキダシまでぼかさないよう、絵の直後にぼかす
    if (panel.frame === 'soft') drawSoftEdge(c, outline, unit.w, ground)
    withClip(c, outline, () => drawSfx(panel))
    if (opts.panelNumbers) {
      drawPanelNumber(c, panel.order, outline, unit.w * NOTE_FONT * 1.5)
    }
    // 枠の外に出た部分をコマの輪郭で切り、切り口に枠線が重なるよう枠より先に描く
    withClip(c, outline, () => drawBubbles(panel, false))
    if (hasFrameLine(panel.frame)) drawFrame(c, outline, unit.w * FRAME_WIDTH, panel.frame)
  })

  // はみ出したフキダシを後ろのコマが隠さないよう、全コマの後に描く
  for (const panel of panels) drawBubbles(panel, true)

  if (page.overlay) {
    c.save()
    c.globalCompositeOperation = 'multiply'
    c.fillStyle = OVERLAY_COLORS[page.overlay]
    c.fillRect(pageRect.x, pageRect.y, pageRect.w, pageRect.h)
    c.restore()
  }

  if (margin > 0) {
    const area: PxRect = { x: marginOnLeft ? 0 : pageSize.w, y: 0, w: margin, h: pageSize.h }
    const notes = byOrder(page.panels).map((panel) => ({
      ...panel,
      acting: actingNotes(panel, ctx.characters),
    }))
    drawNotesMargin(c, notes, area, unit.w * MARGIN_FONT)
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
  const artDir = new URL('../../../fixtures/art/', String(import.meta.url))

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

  test("notes: 'margin' の余白にコマの芝居も書き、紙面は変えない", async () => {
    const opts: RenderOptions = { width: SNAPSHOT_WIDTH, notes: 'margin', panelNumbers: false }
    const acted: Page = {
      ...emptyPage,
      panels: emptyPage.panels.map((panel) =>
        panel.id === 'pn_1'
          ? { ...panel, acting: [{ characterId: 'chr_e', text: '振り向いて驚く' }] }
          : panel,
      ),
    }
    const pixels = async (page: Page) => {
      const { ctx, width, height } = await drawPage(page, noAssets, opts)
      return ctx.getImageData(0, 0, width, height)
    }
    const before = await pixels(emptyPage)
    const after = await pixels(acted)
    // 右綴じなので余白は紙面の右
    const pageWidth = pagePixelSize(project.settings, SNAPSHOT_WIDTH).w
    const changed = new Set<string>()
    for (let i = 0; i < before.data.length; i += 4) {
      if (before.data[i] !== after.data[i]) {
        changed.add((i / 4) % before.width < pageWidth ? 'page' : 'margin')
      }
    }
    expect([...changed]).toEqual(['margin'])
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

  test('書体: ゴシック、太ゴシック、明朝、丸ゴシック、手書き風のセリフを並べて描く', async () => {
    const [pn1, ...rest] = emptyPage.panels as [Panel, ...Panel[]]
    const typefaces = ['gothic', 'bold', 'mincho', 'rounded', 'hand'] as const
    const bubbles = typefaces.map((typeface, i) => ({
      id: `bb_${typeface}`,
      order: i + 1,
      text: '書体の見本',
      shape: 'none' as const,
      typeface,
      pos: { x: 0.86 - i * 0.17, y: 0.5 },
      size: { w: 0.13, h: 0.9 },
    }))
    const page: Page = { ...emptyPage, panels: [{ ...pn1, bubbles }, ...rest] }
    const png = await renderPage(page, noAssets, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: false,
    })
    await matchPngSnapshot('page-typefaces', png)
  })

  test('しっぽの複数あるフキダシは、しっぽごとに本体から先端へ描く', async () => {
    const panels = emptyPage.panels.map((panel) => ({
      ...panel,
      bubbles: panel.bubbles.map((b, i) =>
        i === 0
          ? {
              ...b,
              tails: [...(b.tails ?? []), { x: 0.95, y: 0.9 }, { x: 0.5, y: 0.05 }],
            }
          : b,
      ),
    }))
    const png = await renderPage({ ...emptyPage, panels }, noAssets, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: false,
    })
    await matchPngSnapshot('page-tails', png)
  })

  test('ルビと傍点: 傍点の中のルビ付きの語には傍点を打たず、対の無い《《は字のまま描く', async () => {
    const [pn1, ...rest] = emptyPage.panels as [Panel, ...Panel[]]
    const texts = ['それは《《本当》》だ', '《《この|魔法《まほう》だ》》', '《《まだ']
    const bubbles = texts.map((text, i) => ({
      id: `bb_emphasis_${i}`,
      order: i + 1,
      text,
      shape: 'none' as const,
      pos: { x: 0.8 - i * 0.3, y: 0.5 },
      size: { w: 0.2, h: 0.9 },
    }))
    const page: Page = { ...emptyPage, panels: [{ ...pn1, bubbles }, ...rest] }
    const png = await renderPage(page, noAssets, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: false,
    })
    await matchPngSnapshot('page-emphasis', png)
  })

  test('モノローグ枠は角を丸めた白地の四角をしっぽ無しで描き、ナレーションの角は丸めない', async () => {
    const [pn1, ...rest] = emptyPage.panels as [Panel, ...Panel[]]
    const shapes = ['narration', 'monologue'] as const
    const bubbles: Bubble[] = shapes.map((shape, i) => ({
      id: `bb_${shape}`,
      order: i + 1,
      text: '心の声の見本',
      shape,
      pos: { x: 0.7 - i * 0.4, y: 0.5 },
      size: { w: 0.25, h: 0.8 },
      // しっぽの付かない形なので描かれない
      tails: [{ x: 0.5, y: 0.95 }],
    }))
    const panel: Panel = { ...pn1, note: undefined, camera: undefined, bubbles }
    const page: Page = { ...emptyPage, panels: [panel, ...rest] }
    const png = await renderPage(page, noAssets, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: false,
    })
    await matchPngSnapshot('page-monologue', png)
  })

  test('黒塗りのコマは輪郭の内側を黒で塗り、地の無いフキダシのセリフを白で描く', async () => {
    const [pn1, ...rest] = emptyPage.panels as [Panel, ...Panel[]]
    const bubble = {
      id: 'bb_black',
      order: 1,
      text: 'ーーーーーー',
      shape: 'none' as const,
      pos: { x: 0.5, y: 0.5 },
      size: { w: 0.3, h: 0.8 },
    }
    const page: Page = {
      ...emptyPage,
      panels: [{ ...pn1, fill: 'black', bubbles: [bubble] }, ...rest],
    }
    const png = await renderPage(page, noAssets, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: false,
    })
    const { width, data } = await pixels(png)
    const px = (p: { x: number; y: number }) => {
      const at = (Math.round(p.y) * width + Math.round(p.x)) * 4
      return [data[at], data[at + 1], data[at + 2]]
    }
    const rect = pn1.rect
    const pageH = Math.round((width * project.settings.pageSize.h) / project.settings.pageSize.w)
    const corner = { x: (rect.x + rect.w * 0.05) * width, y: (rect.y + rect.h * 0.9) * pageH }
    expect(px(corner)).toEqual([0, 0, 0])
    // 縦棒の長音を並べたセリフなので、箱の中央の列に白い画素がある
    const cx = (rect.x + rect.w * 0.5) * width
    const column = Array.from({ length: Math.round(rect.h * pageH * 0.3) }, (_, i) =>
      px({ x: cx, y: (rect.y + rect.h * 0.35) * pageH + i }),
    )
    expect(column.some(([r]) => (r ?? 0) > 200)).toBe(true)
  })

  test('黒フキダシは体を黒で塗ってセリフを白で描き、地の無い形では黒を無視する', async () => {
    const [pn1, ...rest] = emptyPage.panels as [Panel, ...Panel[]]
    const draw = async (shape: Bubble['shape']) => {
      const bubble: Bubble = {
        id: 'bb_black',
        order: 1,
        text: 'ーーーーーー',
        shape,
        fill: 'black',
        pos: { x: 0.5, y: 0.5 },
        size: { w: 0.3, h: 0.8 },
      }
      // 指示メモが紙面に出て画素の判定にかからないよう消す
      const panel: Panel = { ...pn1, note: undefined, camera: undefined, bubbles: [bubble] }
      const page: Page = { ...emptyPage, panels: [panel, ...rest] }
      const png = await renderPage(page, noAssets, {
        width: SNAPSHOT_WIDTH,
        notes: 'none',
        panelNumbers: false,
      })
      const { width, data } = await pixels(png)
      const pageH = Math.round((width * project.settings.pageSize.h) / project.settings.pageSize.w)
      const at = (x: number, y: number) => {
        const row = Math.round((pn1.rect.y + pn1.rect.h * y) * pageH)
        const col = Math.round((pn1.rect.x + pn1.rect.w * x) * width)
        return data[(row * width + col) * 4] ?? 0
      }
      // 縦棒の長音を並べたセリフなので、箱の中央の列に文字の画素がある
      const column = Array.from({ length: 40 }, (_, i) => at(0.5, 0.35 + (0.3 * i) / 40))
      return { corner: at(0.5 - 0.15 * 0.9, 0.5 + 0.4 * 0.9), column }
    }
    const black = await draw('narration')
    expect(black.corner).toBe(0)
    expect(black.column.some((v) => v > 200)).toBe(true)
    const none = await draw('none')
    expect(none.corner).toBe(255)
    expect(none.column.some((v) => v < 100)).toBe(true)
  })

  test('横書き: ルビ、英文、黒フキダシのセリフを左から右へ書き、上から下へ行を送る', async () => {
    const [pn1, ...rest] = emptyPage.panels as [Panel, ...Panel[]]
    const bubble = (id: string, text: string, x: number, extra: Partial<Bubble> = {}): Bubble => ({
      id,
      order: 1,
      text,
      shape: 'narration',
      writing: 'horizontal',
      pos: { x, y: 0.5 },
      size: { w: 0.3, h: 0.5 },
      ...extra,
    })
    const bubbles = [
      bubble('bb_ruby', 'あの|魔法陣《まほうじん》が、光った。', 0.8),
      bubble('bb_english', 'Hello, world! This is a sign.', 0.5, { shape: 'electronic' }),
      bubble('bb_black', '画面の中の文字', 0.2, { fill: 'black' }),
    ]
    const panel: Panel = { ...pn1, note: undefined, camera: undefined, bubbles }
    const png = await renderPage({ ...emptyPage, panels: [panel, ...rest] }, noAssets, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: false,
    })
    await matchPngSnapshot('page-horizontal', png)
  })

  test('横書きの長音は回さず、箱の中央を横に貫く 1 行に並べる', async () => {
    const [pn1, ...rest] = emptyPage.panels as [Panel, ...Panel[]]
    const draw = async (writing?: Bubble['writing']) => {
      const bubble: Bubble = {
        id: 'bb_line',
        order: 1,
        text: 'ーーーーーー',
        shape: 'none',
        ...(writing && { writing }),
        pos: { x: 0.5, y: 0.5 },
        size: { w: 0.8, h: 0.3 },
      }
      // 指示メモが紙面に出て画素の判定にかからないよう消す
      const panel: Panel = { ...pn1, note: undefined, camera: undefined, bubbles: [bubble] }
      const png = await renderPage({ ...emptyPage, panels: [panel, ...rest] }, noAssets, {
        width: SNAPSHOT_WIDTH,
        notes: 'none',
        panelNumbers: false,
      })
      const { width, data } = await pixels(png)
      const pageH = Math.round((width * project.settings.pageSize.h) / project.settings.pageSize.w)
      const at = (x: number, y: number) => {
        const row = Math.round((pn1.rect.y + pn1.rect.h * y) * pageH)
        const col = Math.round((pn1.rect.x + pn1.rect.w * x) * width)
        return data[(row * width + col) * 4] ?? 0
      }
      // コマの幅の 3 割から 7 割の列のうち、中央の帯に文字の画素がある列の数
      return Array.from({ length: 40 }, (_, i) => 0.3 + (0.4 * i) / 40).filter((x) =>
        Array.from({ length: 40 }, (_, j) => at(x, 0.4 + (0.2 * j) / 40)).some((v) => v < 100),
      ).length
    }
    expect(await draw('horizontal')).toBeGreaterThanOrEqual(25)
    // 縦書きでは長音を回して縦棒にするので、帯を横に貫かない
    expect(await draw()).toBeLessThan(15)
  })

  test('枠なしのコマは枠線を引かず、order に関わらず枠ありのコマの下に敷く', async () => {
    const [pn1, pn2, ...rest] = emptyPage.panels as [Panel, Panel, ...Panel[]]
    const background: Panel = {
      ...pn1,
      id: 'pn_bg',
      order: 99,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      fill: 'black',
      frame: 'none',
      bubbles: [],
    }
    const draw = async (panels: Panel[]) => {
      const png = await renderPage({ ...emptyPage, panels }, noAssets, {
        width: SNAPSHOT_WIDTH,
        notes: 'none',
        panelNumbers: false,
      })
      const { width, data } = await pixels(png)
      const pageH = Math.round((width * project.settings.pageSize.h) / project.settings.pageSize.w)
      return (x: number, y: number) =>
        data[(Math.round(y * pageH) * width + Math.round(x * width)) * 4]
    }
    // pn1 の下辺の中央。枠ありなら枠線が乗る
    const edge = { x: pn1.rect.x + pn1.rect.w / 2, y: pn1.rect.y + pn1.rect.h }
    expect(await draw([pn1, pn2, ...rest]).then((at) => at(edge.x, edge.y))).toBeLessThan(128)
    const borderless = await draw([{ ...pn1, frame: 'none' }, pn2, ...rest])
    expect(borderless(edge.x, edge.y)).toBe(255)

    const laid = await draw([background, pn1, pn2, ...rest])
    // pn_2 と pn_3 の隙間
    expect(laid(0.49, 0.4)).toBe(0)
    const inside = { x: pn2.rect.x + pn2.rect.w * 0.9, y: pn2.rect.y + pn2.rect.h * 0.9 }
    expect(laid(inside.x, inside.y)).toBe(255)
  })

  test('黒い地のページは間白を黒くし、コマの中は白いまま', async () => {
    const [pn1, pn2] = emptyPage.panels as [Panel, Panel]
    const png = await renderPage({ ...emptyPage, ground: 'black' }, noAssets, {
      width: SNAPSHOT_WIDTH,
      notes: 'margin',
      panelNumbers: false,
    })
    const { width, data } = await pixels(png)
    const pageH = Math.round((width * project.settings.pageSize.h) / project.settings.pageSize.w)
    const pageW = SNAPSHOT_WIDTH
    const at = (x: number, y: number) =>
      data[(Math.round(y * pageH) * width + Math.round(x * pageW)) * 4]
    // pn_2 と pn_3 の隙間
    expect(at(0.49, 0.4)).toBe(0)
    expect(at(pn1.rect.x + pn1.rect.w * 0.6, pn1.rect.y + pn1.rect.h * 0.8)).toBe(255)
    expect(at(pn2.rect.x + pn2.rect.w * 0.9, pn2.rect.y + pn2.rect.h * 0.9)).toBe(255)
    // 指示メモの余白は白のまま
    expect(data[(Math.round(pageH / 2) * width + width - 2) * 4]).toBe(255)
  })

  test('色調はコマの絵にだけ掛かる', async () => {
    const { page, ctx } = withArts()
    const opts: RenderOptions = { width: SNAPSHOT_WIDTH, notes: 'none', panelNumbers: false }
    const plain = await pixels(await renderPage(page, ctx, opts))
    const faded = await pixels(await renderPage({ ...page, tone: 'faded' }, ctx, opts))
    const sepia = await pixels(await renderPage({ ...page, tone: 'sepia' }, ctx, opts))
    const count = (data: Uint8ClampedArray, hit: (r: number, b: number) => boolean) => {
      let n = 0
      for (let i = 0; i < data.length; i += 4) if (hit(data[i] ?? 0, data[i + 2] ?? 0)) n++
      return n
    }
    // 薄墨は絵を 0.4 より暗くしないので暗い画素が減る。残る暗い画素は色調を掛けない枠線とセリフ
    const dark = (r: number) => r < 100
    expect(count(faded.data, dark)).toBeLessThan(count(plain.data, dark))
    expect(count(faded.data, dark)).toBeGreaterThan(0)
    const warm = (r: number, b: number) => r > b + 10
    expect(count(sepia.data, warm)).toBeGreaterThan(count(plain.data, warm))
  })

  test('コマの色調はページの色調を上書きし、none のコマには掛けず、他のコマはページの色調のまま', async () => {
    const { page, ctx } = withArts()
    const opts: RenderOptions = { width: SNAPSHOT_WIDTH, notes: 'none', panelNumbers: false }
    const [pn1, pn2] = page.panels as [Panel, Panel]
    const withTone = (tone: Panel['tone']) =>
      page.panels.map((panel) => (panel.id === pn1.id ? { ...panel, tone } : panel))
    const plain = await pixels(await renderPage(page, ctx, opts))
    const sepia = await pixels(await renderPage({ ...page, tone: 'sepia' }, ctx, opts))
    const sepiaButOne = await pixels(
      await renderPage({ ...page, tone: 'sepia', panels: withTone('none') }, ctx, opts),
    )
    const oneSepia = await pixels(
      await renderPage({ ...page, panels: withTone('sepia') }, ctx, opts),
    )
    const { width } = plain
    const pageH = Math.round((width * project.settings.pageSize.h) / project.settings.pageSize.w)
    /** コマの rect から縁を 1 割ずつ除いた範囲の画素。枠線を避ける */
    const region = (data: Uint8ClampedArray, panel: Panel) => {
      const { x, y, w, h } = panel.rect
      const out: number[] = []
      for (let py = Math.ceil((y + h * 0.1) * pageH); py < (y + h * 0.9) * pageH; py += 3) {
        for (let px = Math.ceil((x + w * 0.1) * width); px < (x + w * 0.9) * width; px += 3) {
          const i = (py * width + px) * 4
          out.push(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
        }
      }
      return out
    }
    expect(region(sepia.data, pn1)).not.toEqual(region(plain.data, pn1))
    expect(region(sepiaButOne.data, pn1)).toEqual(region(plain.data, pn1))
    expect(region(sepiaButOne.data, pn2)).toEqual(region(sepia.data, pn2))
    expect(region(oneSepia.data, pn1)).toEqual(region(sepia.data, pn1))
    expect(region(oneSepia.data, pn2)).toEqual(region(plain.data, pn2))
  })

  test('コマの色調: セピアのページで 1 コマを生の色に、1 コマを色あせにして描く', async () => {
    const { page, ctx } = withArts()
    const tones: Record<string, Panel['tone']> = { pn_1: 'none', pn_2: 'faded' }
    const png = await renderPage(
      {
        ...page,
        tone: 'sepia',
        panels: page.panels.map((panel) => {
          const tone = tones[panel.id]
          return tone ? { ...panel, tone } : panel
        }),
      },
      ctx,
      { width: SNAPSHOT_WIDTH, notes: 'none', panelNumbers: false },
    )
    await matchPngSnapshot('page-panel-tones', png)
  })

  test('紙面全体のトーンはフキダシと間白を含む紙面の全画素に乗算で掛かり、指示メモの余白には掛からない', async () => {
    const opts: RenderOptions = { width: SNAPSHOT_WIDTH, notes: 'margin', panelNumbers: false }
    const plain = await pixels(await renderPage(emptyPage, noAssets, opts))
    const toned = await pixels(await renderPage({ ...emptyPage, overlay: 'gray' }, noAssets, opts))
    const gray = Number.parseInt(OVERLAY_COLORS.gray.slice(1, 3), 16)
    let worst = 0
    let white = 0
    for (let y = 0; y < plain.height; y++) {
      for (let x = 0; x < SNAPSHOT_WIDTH; x++) {
        const i = (y * plain.width + x) * 4
        const before = plain.data[i] ?? 0
        if (before === 255) white++
        worst = Math.max(worst, Math.abs((toned.data[i] ?? 0) - (before * gray) / 255))
      }
    }
    expect(white).toBeGreaterThan(0)
    expect(worst).toBeLessThanOrEqual(1)
    const margin = (Math.round(plain.height / 2) * plain.width + plain.width - 2) * 4
    expect(toned.data[margin]).toBe(255)
  })

  test('枠の種類: 角丸、波線、破線、二重線、ぼかし、雲形を黒い地とセピアのページで描く', async () => {
    const { page, ctx } = withArts()
    const frames = ['round', 'wavy', 'dashed', 'double', 'soft', 'cloud'] as const
    const styled: Page = {
      ...page,
      ground: 'black',
      tone: 'sepia',
      panels: page.panels.map((panel, i) => {
        const frame = frames[i]
        return frame ? { ...panel, frame } : panel
      }),
    }
    const png = await renderPage(styled, ctx, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: false,
    })
    await matchPngSnapshot('page-frames', png)
  })

  const sfxFocus = (id: string, patch: Partial<FocusPoint>): FocusPoint => ({
    id,
    kind: 'sfx',
    label: 'ドン',
    pos: { x: 0.5, y: 0.5 },
    weight: 0.5,
    ...patch,
  })

  test('描き文字: sfx の焦点の label を太ゴシックの縦書きで白いふち付きに描き、コマの輪郭で切ってフキダシの下に置く', async () => {
    const { page, ctx } = withArts()
    const [pn1, pn2, ...rest] = page.panels as [Panel, Panel, ...Panel[]]
    const styled: Page = {
      ...page,
      panels: [
        {
          ...pn1,
          focusPoints: [
            // pn_1 のフキダシ bb_1 の下に潜る
            sfxFocus('fp_sfx_1', { label: 'ゴゴゴ', pos: { x: 0.85, y: 0.4 }, weight: 1 }),
            // コマの左端からはみ出して切れる
            sfxFocus('fp_sfx_2', { label: 'ザッ\nザッ', pos: { x: 0.02, y: 0.6 }, weight: 0 }),
          ],
        },
        { ...pn2, focusPoints: [sfxFocus('fp_sfx_3', { label: 'ドンッ!!', weight: 0.5 })] },
        ...rest,
      ],
    }
    const png = await renderPage(styled, ctx, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: false,
    })
    await matchPngSnapshot('page-sfx', png)
  })

  test('描き文字は sfx の焦点にだけ、label があるときだけ描く', async () => {
    const opts: RenderOptions = { width: SNAPSHOT_WIDTH, notes: 'none', panelNumbers: false }
    const [pn1, pn2, ...rest] = emptyPage.panels as [Panel, Panel, ...Panel[]]
    const withFocus = (focusPoints: FocusPoint[]): Page => ({
      ...emptyPage,
      panels: [pn1, { ...pn2, focusPoints }, ...rest],
    })
    const draw = async (page: Page) => (await pixels(await renderPage(page, noAssets, opts))).data
    const plain = await draw(withFocus([]))
    const differs = (data: Uint8ClampedArray) => data.some((v, i) => v !== plain[i])

    expect(differs(await draw(withFocus([sfxFocus('fp_a', { label: '' })])))).toBe(false)
    expect(differs(await draw(withFocus([sfxFocus('fp_b', { kind: 'face' })])))).toBe(false)
    expect(differs(await draw(withFocus([sfxFocus('fp_c', { kind: 'keyObject' })])))).toBe(false)

    const drawn = await draw(withFocus([sfxFocus('fp_d', {})]))
    const width = SNAPSHOT_WIDTH
    const pageH = Math.round((width * project.settings.pageSize.h) / project.settings.pageSize.w)
    // 焦点の位置を中心に、字の高さの 2 字ぶんの範囲で黒い画素が増える
    const cx = Math.round((pn2.rect.x + pn2.rect.w * 0.5) * width)
    const cy = Math.round((pn2.rect.y + pn2.rect.h * 0.5) * pageH)
    const size = Math.round(sfxFontSize({ weight: 0.5 }, pn2.rect.w * width, pn2.rect.h * pageH))
    const darkAround = (data: Uint8ClampedArray) => {
      let n = 0
      for (let y = cy - size; y < cy + size; y++) {
        for (let x = cx - size; x < cx + size; x++) {
          if ((data[(y * width + x) * 4] ?? 255) < 64) n++
        }
      }
      return n
    }
    expect(darkAround(drawn)).toBeGreaterThan(darkAround(plain))
  })

  test('描き文字: 焦点ごとの傾き、書体、大きさで描く', async () => {
    const { page, ctx } = withArts()
    const [pn1, pn2, pn3, ...rest] = page.panels as [Panel, Panel, Panel, ...Panel[]]
    const styled: Page = {
      ...page,
      panels: [
        {
          ...pn1,
          focusPoints: [
            sfxFocus('fp_sfx_1', { label: 'ゴゴゴ', pos: { x: 0.3, y: 0.5 }, rotation: -20 }),
            sfxFocus('fp_sfx_2', {
              label: 'ザッ',
              pos: { x: 0.75, y: 0.6 },
              weight: 0,
              typeface: 'mincho',
              scale: 2.5,
            }),
          ],
        },
        {
          ...pn2,
          focusPoints: [
            sfxFocus('fp_sfx_3', { label: 'ドンッ!!', rotation: 90, typeface: 'hand', scale: 0.6 }),
          ],
        },
        { ...pn3, focusPoints: [sfxFocus('fp_sfx_4', { label: 'シーン', rotation: 180 })] },
        ...rest,
      ],
    }
    const png = await renderPage(styled, ctx, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: false,
    })
    await matchPngSnapshot('page-sfx-styled', png)
  })

  test('描き文字の傾きは焦点を中心に字の並びを回し、大きさの倍率は字を大きくする', async () => {
    const opts: RenderOptions = { width: SNAPSHOT_WIDTH, notes: 'none', panelNumbers: false }
    const [pn1, pn2, ...rest] = emptyPage.panels as [Panel, Panel, ...Panel[]]
    const withFocus = (focusPoints: FocusPoint[]): Page => ({
      ...emptyPage,
      panels: [pn1, { ...pn2, focusPoints }, ...rest],
    })
    const draw = async (page: Page) => (await pixels(await renderPage(page, noAssets, opts))).data
    const drawSfx = (patch: Partial<FocusPoint>) =>
      draw(withFocus([sfxFocus('fp', { label: 'ドドド', weight: 0.2, ...patch })]))
    const width = SNAPSHOT_WIDTH
    const pageH = Math.round((width * project.settings.pageSize.h) / project.settings.pageSize.w)
    const plain = await draw(withFocus([]))
    /** plain に無く増えた黒い画素を囲む矩形の幅と高さ */
    const inked = (data: Uint8ClampedArray) => {
      const x0 = Math.ceil(pn2.rect.x * width)
      const x1 = Math.floor((pn2.rect.x + pn2.rect.w) * width)
      const y0 = Math.ceil(pn2.rect.y * pageH)
      const y1 = Math.floor((pn2.rect.y + pn2.rect.h) * pageH)
      let box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4
          if ((data[i] ?? 255) < 64 && (plain[i] ?? 255) >= 64) {
            box = {
              left: Math.min(box.left, x),
              right: Math.max(box.right, x),
              top: Math.min(box.top, y),
              bottom: Math.max(box.bottom, y),
            }
          }
        }
      }
      return { w: box.right - box.left, h: box.bottom - box.top }
    }

    const upright = inked(await drawSfx({}))
    expect(upright.h).toBeGreaterThan(upright.w * 2)
    const turned = inked(await drawSfx({ rotation: 90 }))
    expect(turned.w).toBeGreaterThan(turned.h * 2)
    expect(turned.w).toBeCloseTo(upright.h, -1)
    const doubled = inked(await drawSfx({ scale: 2 }))
    expect(doubled.h).toBeGreaterThan(upright.h * 1.8)
  })

  test('効果線: 集中線、スピード線、黒塗りのコマの白い集中線を絵の上に描く', async () => {
    const { page, ctx } = withArts()
    const effects: Partial<Panel>[] = [
      { effect: 'focus_lines' },
      { effect: 'speed_lines' },
      { effect: 'focus_lines', fill: 'black' },
      { effect: 'speed_lines', vectors: [] },
    ]
    const withEffects: Page = {
      ...page,
      panels: page.panels.map((panel, i) => ({ ...panel, ...effects[i] })),
    }
    const png = await renderPage(withEffects, ctx, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: false,
    })
    await matchPngSnapshot('page-effects', png)
  })

  test('集中線は焦点のまわりの楕円を空けて描き、黒塗りのコマでは白い線にする', async () => {
    const pn5 = emptyPage.panels.find((p) => p.id === 'pn_5') as Panel
    const bare: Panel = { ...pn5, bubbles: [], focusPoints: [], vectors: [] }
    const opts: RenderOptions = { width: SNAPSHOT_WIDTH, notes: 'none', panelNumbers: false }
    const draw = async (panel: Panel) => {
      const others = emptyPage.panels.filter((p) => p.id !== pn5.id)
      const { width, data } = await pixels(
        await renderPage({ ...emptyPage, panels: [...others, panel] }, noAssets, opts),
      )
      const pageH = Math.round((width * project.settings.pageSize.h) / project.settings.pageSize.w)
      const rect = rectToPx(panel.rect, { x: 0, y: 0, w: width, h: pageH })
      // コマの中の画素を、中心からの楕円の距離（集中線を入れない楕円の縁が 1）ごとに数える
      return (hit: (r: number) => boolean, from: number, to: number) => {
        let n = 0
        const cx = rect.x + rect.w / 2
        const cy = rect.y + rect.h / 2
        for (let y = Math.ceil(rect.y + 2); y < rect.y + rect.h - 2; y++) {
          for (let x = Math.ceil(rect.x + 2); x < rect.x + rect.w - 2; x++) {
            const e = Math.hypot((x - cx) / (rect.w * 0.3), (y - cy) / (rect.h * 0.3))
            if (e >= from && e < to && hit(data[(y * width + x) * 4] ?? 0)) n++
          }
        }
        return n
      }
    }
    const dark = (r: number) => r < 128
    const plain = await draw(bare)
    const focused = await draw({ ...bare, effect: 'focus_lines' })
    expect(focused(dark, 0, 0.95)).toBe(plain(dark, 0, 0.95))
    expect(focused(dark, 1.5, Infinity)).toBeGreaterThan(plain(dark, 1.5, Infinity))

    const light = (r: number) => r > 128
    const black = await draw({ ...bare, fill: 'black' })
    const blackFocused = await draw({ ...bare, fill: 'black', effect: 'focus_lines' })
    expect(black(light, 0, Infinity)).toBe(0)
    expect(blackFocused(light, 0, 0.95)).toBe(0)
    expect(blackFocused(light, 1.5, Infinity)).toBeGreaterThan(0)
  })

  test('ベタフラ: コマの地を黒で塗り、焦点から白い線を描き、フキダシのセリフを白抜きにする', async () => {
    const { page, ctx } = withArts()
    const [pn1, pn2, pn3, ...rest] = page.panels as [Panel, Panel, Panel, ...Panel[]]
    const bubble: Bubble = {
      id: 'bb_flash',
      order: 9,
      text: 'ーーーー',
      shape: 'none',
      pos: { x: 0.2, y: 0.5 },
      size: { w: 0.2, h: 0.6 },
    }
    const withFlash: Page = {
      ...page,
      panels: [
        { ...pn1, artId: undefined, arts: [], effect: 'beta_flash' },
        { ...pn2, artId: undefined, arts: [], effect: 'beta_flash', bubbles: [bubble] },
        { ...pn3, effect: 'beta_flash' },
        ...rest,
      ],
    }
    const png = await renderPage(withFlash, ctx, {
      width: SNAPSHOT_WIDTH,
      notes: 'none',
      panelNumbers: false,
    })
    await matchPngSnapshot('page-beta-flash', png)
  })

  test('ベタフラは中心のまわりを白く抜いて外を黒く残し、地の無いフキダシのセリフを白で描く', async () => {
    const pn5 = emptyPage.panels.find((p) => p.id === 'pn_5') as Panel
    const bare: Panel = {
      ...pn5,
      note: undefined,
      camera: undefined,
      bubbles: [],
      focusPoints: [],
      vectors: [],
      effect: 'beta_flash',
    }
    const opts: RenderOptions = { width: SNAPSHOT_WIDTH, notes: 'none', panelNumbers: false }
    const draw = async (panel: Panel) => {
      const others = emptyPage.panels.filter((p) => p.id !== pn5.id)
      const { width, data } = await pixels(
        await renderPage({ ...emptyPage, panels: [...others, panel] }, noAssets, opts),
      )
      const pageH = Math.round((width * project.settings.pageSize.h) / project.settings.pageSize.w)
      const rect = rectToPx(panel.rect, { x: 0, y: 0, w: width, h: pageH })
      // コマの中の box（コマの rect に対する比）にある画素のうち、白い画素の割合
      return (box: { x: number; y: number; w: number; h: number }) => {
        const px = rectToPx(box, rect)
        let light = 0
        let all = 0
        for (let y = Math.ceil(px.y); y < px.y + px.h; y++) {
          for (let x = Math.ceil(px.x); x < px.x + px.w; x++) {
            all++
            if ((data[(y * width + x) * 4] ?? 0) > 128) light++
          }
        }
        return light / all
      }
    }
    const flash = await draw(bare)
    expect(flash({ x: 0.47, y: 0.47, w: 0.06, h: 0.06 })).toBeGreaterThan(0.8)
    const corner = { x: 0.02, y: 0.02, w: 0.1, h: 0.1 }
    expect(flash(corner)).toBeLessThan(0.5)

    const bubbleBox = { x: 0.02, y: 0.1, w: 0.16, h: 0.8 }
    const bubble: Bubble = {
      id: 'bb_flash',
      order: 1,
      text: 'ーーーーーー',
      shape: 'none',
      pos: { x: bubbleBox.x + bubbleBox.w / 2, y: 0.5 },
      size: { w: bubbleBox.w, h: bubbleBox.h },
    }
    const withBubble = await draw({ ...bare, bubbles: [bubble] })
    expect(withBubble(bubbleBox)).toBeGreaterThan(flash(bubbleBox))
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
