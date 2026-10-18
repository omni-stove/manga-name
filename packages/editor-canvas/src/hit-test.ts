import {
  type Bubble,
  containsPoint,
  isBoxShape,
  type Page,
  type Panel,
  panelOutline,
} from '@manga/schema'
import { type Box, bubbleGeometry } from './bubble-shape'
import type { Selection } from './types'

/** ページ座標（mm）の点 */
export interface PagePoint {
  x: number
  y: number
}

/** コマの正規化 rect をページ座標（mm）の矩形にする */
export function panelBox(panel: Pick<Panel, 'rect'>, width: number, height: number): Box {
  return {
    x: panel.rect.x * width,
    y: panel.rect.y * height,
    w: panel.rect.w * width,
    h: panel.rect.h * height,
  }
}

/** コマの輪郭をページ座標（mm）の頂点列にする */
export function panelPolygon(
  panel: Pick<Panel, 'rect' | 'shape'>,
  width: number,
  height: number,
): PagePoint[] {
  return panelOutline(panel).map((p) => ({ x: p.x * width, y: p.y * height }))
}

/** 頂点列を SVG の points 属性の文字列にする */
export const polygonPoints = (points: readonly PagePoint[]): string =>
  points.map((p) => `${p.x},${p.y}`).join(' ')

/** ページ座標の点がフキダシの本体の中か。panel はフキダシのコマの矩形（mm） */
export function inBubble(bubble: Bubble, panel: Box, p: PagePoint): boolean {
  const g = bubbleGeometry(bubble, panel)
  if (g.rx <= 0 || g.ry <= 0) return false
  const dx = (p.x - g.cx) / g.rx
  const dy = (p.y - g.cy) / g.ry
  return isBoxShape(bubble.shape) ? Math.abs(dx) <= 1 && Math.abs(dy) <= 1 : dx * dx + dy * dy <= 1
}

/**
 * ページ座標の点にある要素。描画の前後と同じく、overflow のフキダシは全コマの後に描かれるので
 * 最も手前、次に各コマ内の overflow でないフキダシ、最後にコマ。それぞれ order の大きいものが手前。
 * overflow でないフキダシは、コマの輪郭で切られて見えない所では当たらない。何も無ければ null
 */
export function hitTest(page: Page, width: number, height: number, p: PagePoint): Selection {
  const panels = [...page.panels].sort((a, b) => b.order - a.order)
  for (const overflow of [true, false]) {
    for (const panel of panels) {
      const box = panelBox(panel, width, height)
      if (!overflow && !containsPoint(panelPolygon(panel, width, height), p)) continue
      for (const bubble of [...panel.bubbles].sort((a, b) => b.order - a.order)) {
        if (Boolean(bubble.overflow) === overflow && inBubble(bubble, box, p)) {
          return { kind: 'bubble', id: bubble.id }
        }
      }
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
    .find((panel) => containsPoint(panelPolygon(panel, width, height), p))
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

  test('hitTest misses the part of a bubble cut off by its panel unless it overflows', () => {
    const bubble = { ...(page.panels[0]?.bubbles[0] as Bubble), pos: { x: 1, y: 0.5 } }
    const edged = (overflow?: boolean): Page => ({
      ...page,
      panels: [
        {
          ...(page.panels[0] as Panel),
          rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
          bubbles: [{ ...bubble, size: { w: 0.4, h: 0.4 }, overflow }],
        },
      ],
    })
    const inside = { x: 0.45 * w, y: 0.25 * h }
    const outside = { x: 0.55 * w, y: 0.25 * h }
    expect(hitTest(edged(), w, h, inside)).toEqual({ kind: 'bubble', id: bubble.id })
    expect(hitTest(edged(), w, h, outside)).toBeNull()
    expect(hitTest(edged(true), w, h, outside)).toEqual({ kind: 'bubble', id: bubble.id })
  })

  test('hitTest follows the outline of a shaped panel', () => {
    const triangle: Page = {
      ...page,
      panels: [
        {
          ...(page.panels[0] as Panel),
          rect: { x: 0, y: 0, w: 1, h: 1 },
          shape: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
          bubbles: [],
        },
      ],
    }
    expect(hitTest(triangle, w, h, { x: 0.2 * w, y: 0.2 * h })).toEqual({
      kind: 'panel',
      id: 'pn_1',
    })
    expect(hitTest(triangle, w, h, { x: 0.8 * w, y: 0.8 * h })).toBeNull()
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
