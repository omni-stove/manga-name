import { type ID, type Page, panelOutline } from '@manga/schema'
import { getBackend, loadFonts } from './backend'
import { bubbleGeometry, fillBubble } from './bubble'
import { type PxRect, pointToPx, rectToPx } from './geometry'
import { drawFrame, withClip } from './panel'
import { drawPlacement, hasPlacement } from './placement'

const GRAY = '#e0e0e0'
/** pageSize の既定値。ページのアスペクト比の計算に使う */
const DEFAULT_PAGE_SIZE = { w: 182, h: 257 }
/** ページ幅に対する比率。renderPage の枠線と同じ */
const FRAME_WIDTH = 0.003

/**
 * ページ全体の生成に渡す配置図。白地に各コマの輪郭の内側を薄灰で塗ってフキダシ領域を白にし、輪郭に黒い枠線を引く。
 * overflow でないフキダシは輪郭の外を切り、overflow のフキダシは枠線の上に塗る。
 * 最後に焦点と誘導線のあるコマへ配置の印（drawPlacement）を重ねる。
 * 幅は `width`、高さは判型の縦横比から決める。セリフは描かない。`pageSize` の既定は 182x257。
 */
export async function renderPageLayoutPng(
  page: Page,
  opts: { width: number; pageSize?: { w: number; h: number } },
): Promise<Blob> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  const width = Math.max(1, Math.round(opts.width))
  const height = Math.max(1, Math.round((width * pageSize.h) / pageSize.w))

  const [backend] = await Promise.all([getBackend(), loadFonts()])
  const surface = backend.createSurface(width, height)
  const c = surface.ctx
  const pageRect: PxRect = { x: 0, y: 0, w: width, h: height }

  c.fillStyle = '#fff'
  c.fillRect(0, 0, width, height)
  const fillBubbles = (panel: Page['panels'][number], overflow: boolean) => {
    const rect = rectToPx(panel.rect, pageRect)
    for (const bubble of panel.bubbles) {
      if ((bubble.overflow === true) !== overflow) continue
      fillBubble(c, bubble.shape, bubbleGeometry(bubble, rect), '#fff')
    }
  }
  const outlineOf = (panel: Page['panels'][number]) =>
    panelOutline(panel).map((p) => pointToPx(p, pageRect))
  for (const panel of page.panels) {
    const outline = outlineOf(panel)
    c.fillStyle = GRAY
    c.beginPath()
    outline.forEach((p, i) => {
      if (i === 0) c.moveTo(p.x, p.y)
      else c.lineTo(p.x, p.y)
    })
    c.closePath()
    c.fill()
    withClip(c, outline, () => fillBubbles(panel, false))
  }
  const lineWidth = Math.max(1, Math.round(width * FRAME_WIDTH))
  for (const panel of page.panels) drawFrame(c, outlineOf(panel), lineWidth, undefined)
  // はみ出したフキダシを後ろのコマの塗りと枠線が隠さないよう、全コマの後に塗る
  for (const panel of page.panels) fillBubbles(panel, true)
  const mm = width / pageSize.w
  for (const panel of page.panels) {
    if (hasPlacement(panel)) drawPlacement(c, panel, rectToPx(panel.rect, pageRect), mm)
  }
  return surface.toPng()
}

/**
 * ページ全体の絵 `image` を、`page` の各コマを囲む rect で切り抜いた PNG。順は page.panels。
 * 生成画像の縦横比は判型と少し違う（プロバイダの選べる比に丸める）ので、正規化座標を画像の幅と高さそれぞれに掛ける。
 * 多角形のコマも矩形で切り、輪郭で切るのは合成のとき。
 */
export async function cropPanelArts(
  page: Page,
  image: Blob,
): Promise<{ panelId: ID; image: Blob }[]> {
  const backend = await getBackend()
  const source = await backend.decodeImage(image)
  const { width, height } = source as { width: number; height: number }
  const full: PxRect = { x: 0, y: 0, w: width, h: height }
  return Promise.all(
    page.panels.map(async (panel) => {
      const rect = rectToPx(panel.rect, full)
      const x = Math.round(rect.x)
      const y = Math.round(rect.y)
      const w = Math.max(1, Math.round(rect.x + rect.w) - x)
      const h = Math.max(1, Math.round(rect.y + rect.h) - y)
      const surface = backend.createSurface(w, h)
      surface.ctx.drawImage(source, x, y, w, h, 0, 0, w, h)
      return { panelId: panel.id, image: await surface.toPng() }
    }),
  )
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')

  const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page

  const pixels = async (png: Blob) => {
    const backend = await getBackend()
    const image = await backend.decodeImage(png)
    const { width: w, height: h } = image as { width: number; height: number }
    const probe = backend.createSurface(w, h)
    probe.ctx.drawImage(image, 0, 0)
    return {
      w,
      h,
      at: (x: number, y: number) =>
        Array.from(
          probe.ctx.getImageData(Math.round(x * w), Math.round(y * h), 1, 1).data.subarray(0, 3),
        ),
    }
  }

  test('ページの配置図は判型の比で、コマの中が薄灰、フキダシが白、コマの間が白', async () => {
    const png = await pixels(await renderPageLayoutPng(page, { width: 364 }))
    expect(png.w).toBe(364)
    expect(png.h).toBe(Math.round((364 * 257) / 182))
    const pn6 = page.panels.find((p) => p.id === 'pn_6')
    if (!pn6) throw new Error('fixture has no pn_6')
    const inPanel = (x: number, y: number) =>
      png.at(pn6.rect.x + x * pn6.rect.w, pn6.rect.y + y * pn6.rect.h)
    // renderLayoutPng のテストと同じ点。pn_6 のフキダシと地
    expect(inPanel(0.85, 0.3)).toEqual([255, 255, 255])
    expect(inPanel(0.1, 0.15)).toEqual([224, 224, 224])
    // pn_6 の焦点（keyObject）の中心。点が小さく縁がぼけるので、橙に寄っていることだけを見る
    const [r, , b] = inPanel(0.4, 0.5)
    expect(r).toBeGreaterThan(200)
    expect(b).toBeLessThan(100)
    // pn_3 と pn_2 の間の隙間
    expect(png.at(0.49, 0.39)).toEqual([255, 255, 255])
  })

  test('切り抜きは各コマの rect の範囲を、画像の幅と高さに合わせて取る', async () => {
    const backend = await getBackend()
    // 左半分が黒、右半分が白の 200x100。判型と比が違っても正規化座標で切る
    const surface = backend.createSurface(200, 100)
    surface.ctx.fillStyle = '#fff'
    surface.ctx.fillRect(0, 0, 200, 100)
    surface.ctx.fillStyle = '#000'
    surface.ctx.fillRect(0, 0, 100, 100)
    const halves: Page = {
      ...page,
      panels: [
        {
          ...(page.panels[0] as Page['panels'][number]),
          id: 'l',
          rect: { x: 0, y: 0, w: 0.5, h: 1 },
        },
        {
          ...(page.panels[0] as Page['panels'][number]),
          id: 'r',
          rect: { x: 0.5, y: 0.25, w: 0.5, h: 0.5 },
        },
      ],
    }
    const crops = await cropPanelArts(halves, await surface.toPng())
    expect(crops.map((c) => c.panelId)).toEqual(['l', 'r'])
    const left = await pixels(crops[0]?.image as Blob)
    const right = await pixels(crops[1]?.image as Blob)
    expect([left.w, left.h, right.w, right.h]).toEqual([100, 100, 100, 50])
    expect(left.at(0.5, 0.5)).toEqual([0, 0, 0])
    expect(right.at(0.5, 0.5)).toEqual([255, 255, 255])
  })
}
