import type { Point, ProjectSettings, Rect, Size } from '@manga/schema'

/** px 単位の矩形 */
export interface PxRect {
  x: number
  y: number
  w: number
  h: number
}

/** px 単位の点 */
export interface PxPoint {
  x: number
  y: number
}

const MM_PER_INCH = 25.4

/** 出力ページの px サイズ。width 指定時は pageSize のアスペクト比を保ってその幅にする */
export function pagePixelSize(settings: ProjectSettings, width?: number): { w: number; h: number } {
  const { pageSize, dpi } = settings
  const w = Math.round(width ?? (pageSize.w / MM_PER_INCH) * dpi)
  return { w, h: Math.round((w * pageSize.h) / pageSize.w) }
}

/** 正規化座標の Rect を、基準矩形の中の px にする */
export function rectToPx(rect: Rect, base: PxRect): PxRect {
  return {
    x: base.x + rect.x * base.w,
    y: base.y + rect.y * base.h,
    w: rect.w * base.w,
    h: rect.h * base.h,
  }
}

export function pointToPx(p: Point, base: PxRect): { x: number; y: number } {
  return { x: base.x + p.x * base.w, y: base.y + p.y * base.h }
}

export function sizeToPx(s: Size, base: PxRect): { w: number; h: number } {
  return { w: s.w * base.w, h: s.h * base.h }
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const settings = fixtures.samplePage01.settings

  test('pagePixelSize follows dpi, or the given width with the page aspect ratio', () => {
    const w = Math.round((182 / 25.4) * 300)
    expect(pagePixelSize(settings)).toEqual({ w, h: Math.round((w * 257) / 182) })
    expect(pagePixelSize(settings, 400)).toEqual({ w: 400, h: Math.round((400 * 257) / 182) })
    expect(pagePixelSize(settings, 400.4).w).toBe(400)
  })

  test('rectToPx, pointToPx and sizeToPx map normalized values into the base rect', () => {
    const base = { x: 10, y: 20, w: 200, h: 100 }
    expect(rectToPx({ x: 0.5, y: 0.25, w: 0.25, h: 0.5 }, base)).toEqual({
      x: 110,
      y: 45,
      w: 50,
      h: 50,
    })
    expect(pointToPx({ x: 1, y: 1 }, base)).toEqual({ x: 210, y: 120 })
    expect(sizeToPx({ w: 0.1, h: 0.2 }, base)).toEqual({ w: 20, h: 20 })
  })
}
