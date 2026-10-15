import type { Point, ProjectSettings, Rect, Size } from '@manga/schema'

/** px 単位の矩形 */
export interface PxRect {
  x: number
  y: number
  w: number
  h: number
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
