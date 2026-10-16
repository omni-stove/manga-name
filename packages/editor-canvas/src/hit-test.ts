import type { Page, Panel } from '@manga/schema'
import { type Box, bubbleGeometry } from './bubble-shape'
import type { Selection } from './types'

/** ページ座標（mm）の点 */
export interface PagePoint {
  x: number
  y: number
}

/** コマの正規化 rect をページ座標（mm）の矩形にする */
export function panelBox(panel: Panel, width: number, height: number): Box {
  return {
    x: panel.rect.x * width,
    y: panel.rect.y * height,
    w: panel.rect.w * width,
    h: panel.rect.h * height,
  }
}

const inBox = (p: PagePoint, b: Box) =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h

/**
 * ページ座標の点にある要素。描画の前後と同じく、フキダシはコマより手前、
 * フキダシ同士とコマ同士は order の大きいものが手前。何も無ければ null
 */
export function hitTest(page: Page, width: number, height: number, p: PagePoint): Selection {
  const panels = [...page.panels].sort((a, b) => b.order - a.order)
  for (const panel of panels) {
    const box = panelBox(panel, width, height)
    for (const bubble of [...panel.bubbles].sort((a, b) => b.order - a.order)) {
      const g = bubbleGeometry(bubble, box)
      if (g.rx <= 0 || g.ry <= 0) continue
      const dx = (p.x - g.cx) / g.rx
      const dy = (p.y - g.cy) / g.ry
      const inside =
        bubble.shape === 'narration'
          ? Math.abs(dx) <= 1 && Math.abs(dy) <= 1
          : dx * dx + dy * dy <= 1
      if (inside) return { kind: 'bubble', id: bubble.id }
    }
  }
  const panel = panelAt(page, width, height, p)
  return panel === undefined ? null : { kind: 'panel', id: panel.id }
}

/** フキダシを見ずに、ページ座標の点にあるコマ。重なっていれば order の大きいもの */
export function panelAt(
  page: Page,
  width: number,
  height: number,
  p: PagePoint,
): Panel | undefined {
  return [...page.panels]
    .sort((a, b) => b.order - a.order)
    .find((panel) => inBox(p, panelBox(panel, width, height)))
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
  const { w, h } = fixtures.samplePage01.settings.pageSize

  test('hitTest prefers bubbles over panels and returns null outside the page', () => {
    expect(hitTest(page, w, h, { x: 0.5 * w, y: 0.1 * h })).toEqual({ kind: 'panel', id: 'pn_1' })
    // bb_1 は pn_1 の (0.92, 0.22) にある
    expect(hitTest(page, w, h, { x: 0.92 * w, y: 0.22 * 0.26 * h })).toEqual({
      kind: 'bubble',
      id: 'bb_1',
    })
    expect(hitTest(page, w, h, { x: -1, y: -1 })).toBeNull()
    // pn_2 と pn_3 の隙間
    expect(hitTest(page, w, h, { x: 0.49 * w, y: 0.4 * h })).toBeNull()
  })

  test('hitTest picks the panel with the larger order where panels overlap', () => {
    const overlapped: Page = {
      ...page,
      panels: [
        { ...(page.panels[0] as Panel), id: 'a', order: 2, rect: { x: 0, y: 0, w: 1, h: 1 } },
        { ...(page.panels[1] as Panel), id: 'b', order: 1, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      ],
    }
    expect(hitTest(overlapped, w, h, { x: 0.1 * w, y: 0.1 * h })).toEqual({
      kind: 'panel',
      id: 'a',
    })
  })
}
