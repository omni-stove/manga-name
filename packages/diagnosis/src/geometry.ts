import type { Panel, Point } from '@manga/schema'

/** コマ内座標（0..1）をページ座標に変換する */
export const toPage = (panel: Panel, p: Point): Point => ({
  x: panel.rect.x + p.x * panel.rect.w,
  y: panel.rect.y + p.y * panel.rect.h,
})

/** コマ内座標の 2 点のページ座標での距離を、コマの高さで割った値。高さ 0 のコマでは 0 */
export const panelDistance = (panel: Panel, a: Point, b: Point): number =>
  panel.rect.h === 0
    ? 0
    : Math.hypot((a.x - b.x) * panel.rect.w, (a.y - b.y) * panel.rect.h) / panel.rect.h
