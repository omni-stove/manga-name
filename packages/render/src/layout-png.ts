import type { ID, Page } from '@manga/schema'
import { getBackend, loadFonts } from './backend'
import { bubbleGeometry, fillBubble, joinedGeometry } from './bubble'
import type { PxRect } from './geometry'
import { withClip } from './panel'
import { drawPlacement, hasPlacement } from './placement'

const GRAY = '#e0e0e0'
/** pageSize の既定値。コマのアスペクト比の計算に使う */
const DEFAULT_PAGE_SIZE = { w: 182, h: 257 }
const FRAME_WIDTH = 0.006

/**
 * 生成に渡す配置図。対象コマの rect を切り出し、薄灰で塗ってフキダシ領域を白にし、コマの輪郭に黒い枠線を引く。
 * 多角形のコマでは輪郭の外も薄灰のまま残し、overflow でないフキダシも輪郭の外は塗らない。
 * 絵は rect いっぱいに描かせ、輪郭で切るのは合成のとき。
 * 焦点と誘導線があれば、その上に配置の印（drawPlacement）を重ねる。セリフは描かない。
 * `pageSize` はコマのアスペクト比と印の大きさの計算に使い、省略時は既定の 182x257。
 */
export async function renderLayoutPng(
  page: Page,
  panelId: ID,
  opts: { width: number; pageSize?: { w: number; h: number } },
): Promise<Blob> {
  const panel = page.panels.find((p) => p.id === panelId)
  if (!panel) throw new Error(`panel ${panelId} is not in page ${page.id}`)
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  const width = Math.max(1, Math.round(opts.width))
  const aspect = (panel.rect.h * pageSize.h) / (panel.rect.w * pageSize.w)
  const height = Math.max(1, Math.round(width * aspect))

  const [backend] = await Promise.all([getBackend(), loadFonts()])
  const surface = backend.createSurface(width, height)
  const c = surface.ctx
  const rect: PxRect = { x: 0, y: 0, w: width, h: height }

  c.fillStyle = GRAY
  c.fillRect(0, 0, width, height)
  const outline = (panel.shape ?? []).map((p) => ({ x: p.x * width, y: p.y * height }))
  for (const bubble of panel.bubbles) {
    const joined = joinedGeometry(bubble, panel.bubbles, rect)
    const fill = () => fillBubble(c, bubble.shape, bubbleGeometry(bubble, rect), '#fff', joined)
    if (bubble.overflow || outline.length === 0) fill()
    else withClip(c, outline, fill)
  }

  const lineWidth = Math.max(1, Math.round(width * FRAME_WIDTH))
  c.lineWidth = lineWidth
  c.strokeStyle = '#000'
  if (panel.shape) {
    // 輪郭の頂点は囲む矩形の端にあり、そのまま引くと外側の半分がキャンバスから出る。どの辺も内側に同じ全幅を残すため、
    // 輪郭で clip して倍の太さで引く（clip しないと斜めの辺だけ外側にも出て倍の太さになる）
    c.save()
    c.beginPath()
    panel.shape.forEach((p, i) => {
      const x = p.x * width
      const y = p.y * height
      if (i === 0) c.moveTo(x, y)
      else c.lineTo(x, y)
    })
    c.closePath()
    c.clip()
    c.lineWidth = lineWidth * 2
    c.stroke()
    c.restore()
  } else {
    c.strokeRect(lineWidth / 2, lineWidth / 2, width - lineWidth, height - lineWidth)
  }
  if (hasPlacement(panel)) drawPlacement(c, panel, rect, width / (panel.rect.w * pageSize.w))

  return surface.toPng()
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')

  test('Panel 6 はフキダシ領域が白、それ以外が薄灰', async () => {
    const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
    const png = await renderLayoutPng(page, 'pn_6', { width: 400 })

    const backend = await getBackend()
    const image = await backend.decodeImage(png)
    const w = (image as { width: number }).width
    const h = (image as { height: number }).height
    const probe = backend.createSurface(w, h)
    probe.ctx.drawImage(image, 0, 0)
    const at = (x: number, y: number) => {
      const pixel = probe.ctx.getImageData(Math.round(x * w), Math.round(y * h), 1, 1)
      return Array.from(pixel.data.subarray(0, 3))
    }

    expect(w).toBe(400)
    // pn_6 は 0.48 x 0.165 のコマ。ページ 182x257 でのアスペクト比
    expect(h).toBe(Math.round((400 * 0.165 * 257) / (0.48 * 182)))
    expect(at(0.85, 0.3)).toEqual([255, 255, 255])
    expect(at(0.85, 0.15)).toEqual([255, 255, 255])
    expect(at(0.1, 0.15)).toEqual([224, 224, 224])
    expect(at(0.5, 0.85)).toEqual([224, 224, 224])
    expect(at(0, 0.5)).toEqual([0, 0, 0])
  })

  test('焦点はその位置に種別の色の点で、誘導線は緑で描く', async () => {
    const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
    const png = await renderLayoutPng(page, 'pn_6', { width: 400 })
    const backend = await getBackend()
    const image = await backend.decodeImage(png)
    const w = (image as { width: number }).width
    const h = (image as { height: number }).height
    const probe = backend.createSurface(w, h)
    probe.ctx.drawImage(image, 0, 0)
    const at = (x: number, y: number) =>
      Array.from(
        probe.ctx.getImageData(Math.round(x * w), Math.round(y * h), 1, 1).data.subarray(0, 3),
      )
    // pn_6 の焦点 fresh sprouts in footprint（keyObject）は (0.4, 0.5)
    expect(at(0.4, 0.5)).toEqual([0xe0, 0x90, 0x1e])
    // strong の誘導線 (0.8, 0.4) → (0.43, 0.49) の途中
    expect(at(0.6, 0.4 + (0.09 * 0.2) / 0.37)).toEqual([0x2f, 0x9e, 0x6a])
  })

  test('焦点も誘導線も無いコマには印を描かない', async () => {
    const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
    const bare: Page = {
      ...page,
      panels: page.panels.map((p) =>
        p.id === 'pn_6' ? { ...p, focusPoints: [], vectors: [] } : p,
      ),
    }
    const png = await renderLayoutPng(bare, 'pn_6', { width: 400 })
    const backend = await getBackend()
    const image = await backend.decodeImage(png)
    const w = (image as { width: number }).width
    const h = (image as { height: number }).height
    const probe = backend.createSurface(w, h)
    probe.ctx.drawImage(image, 0, 0)
    expect(
      Array.from(
        probe.ctx.getImageData(Math.round(0.4 * w), Math.round(0.5 * h), 1, 1).data.subarray(0, 3),
      ),
    ).toEqual([224, 224, 224])
  })

  test('多角形のコマは輪郭に枠線を引き、輪郭の外も薄灰のまま', async () => {
    const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
    const triangle: Page = {
      ...page,
      panels: page.panels.map((p) =>
        p.id === 'pn_4'
          ? {
              ...p,
              shape: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
              ],
            }
          : p,
      ),
    }
    const png = await renderLayoutPng(triangle, 'pn_4', { width: 400 })
    const backend = await getBackend()
    const image = await backend.decodeImage(png)
    const w = (image as { width: number }).width
    const h = (image as { height: number }).height
    const probe = backend.createSurface(w, h)
    probe.ctx.drawImage(image, 0, 0)
    const at = (x: number, y: number) =>
      Array.from(
        probe.ctx.getImageData(Math.round(x * w), Math.round(y * h), 1, 1).data.subarray(0, 3),
      )
    // 枠線は輪郭の内側に引くので、斜めの辺のすぐ内側を見る。縁がぼけるので薄灰より暗いことだけを見る
    expect(at(0.49, 0.49)[0]).toBeLessThan(200)
    // 輪郭の外へははみ出さない
    expect(at(0.53, 0.53)).toEqual([224, 224, 224])
    expect(at(0.9, 0.9)).toEqual([224, 224, 224])
    expect(at(0.2, 0.2)).toEqual([224, 224, 224])
  })

  test('無いコマは throw', async () => {
    const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
    await expect(renderLayoutPng(page, 'pn_x', { width: 100 })).rejects.toThrow('pn_x')
  })
}
