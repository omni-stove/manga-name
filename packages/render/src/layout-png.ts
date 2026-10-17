import type { ID, Page } from '@manga/schema'
import { getBackend } from './backend'
import { bubbleGeometry, fillBubble } from './bubble'
import type { PxRect } from './geometry'

const GRAY = '#e0e0e0'
/** 03-data-model.md の pageSize の既定値。コマのアスペクト比の計算に使う */
const DEFAULT_PAGE_SIZE = { w: 182, h: 257 }
const FRAME_WIDTH = 0.006

/**
 * 生成に渡す配置図。対象コマの rect を切り出し、薄灰で塗ってフキダシ領域を白にし、コマの輪郭に黒い枠線を引く。
 * 多角形のコマでは輪郭の外も薄灰のまま残す。絵は rect いっぱいに描かせ、輪郭で切るのは合成のとき。
 * 文字は描かない。`pageSize` はコマのアスペクト比の計算に使い、省略時は既定の 182x257。
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

  const backend = await getBackend()
  const surface = backend.createSurface(width, height)
  const c = surface.ctx
  const rect: PxRect = { x: 0, y: 0, w: width, h: height }

  c.fillStyle = GRAY
  c.fillRect(0, 0, width, height)
  for (const bubble of panel.bubbles) {
    fillBubble(c, bubble.shape, bubbleGeometry(bubble, rect), '#fff')
  }

  const lineWidth = Math.max(1, Math.round(width * FRAME_WIDTH))
  c.lineWidth = lineWidth
  c.strokeStyle = '#000'
  if (panel.shape) {
    // 輪郭の頂点は囲む矩形の端にあり、そのまま引くと外側の半分がキャンバスから出る。内側に全幅を残すため clip して倍の太さで引く
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
    expect(at(0.75, 0.48)).toEqual([255, 255, 255])
    expect(at(0.3, 0.5)).toEqual([224, 224, 224])
    expect(at(0.5, 0.85)).toEqual([224, 224, 224])
    expect(at(0, 0.5)).toEqual([0, 0, 0])
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
    // 斜めの枠線は縁がぼけるので、薄灰より暗いことだけを見る
    expect(at(0.5, 0.5)[0]).toBeLessThan(200)
    expect(at(0.9, 0.9)).toEqual([224, 224, 224])
    expect(at(0.2, 0.2)).toEqual([224, 224, 224])
  })

  test('無いコマは throw', async () => {
    const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
    await expect(renderLayoutPng(page, 'pn_x', { width: 100 })).rejects.toThrow('pn_x')
  })
}
