import type { FocusPoint, Panel, Point, Rect } from '../project'

/** 効果の中心。weight が最大の焦点、無ければコマの中心を、box と同じ単位の座標で返す */
export function focusCenter(panel: Pick<Panel, 'focusPoints'>, box: Rect): Point {
  const focus = panel.focusPoints.reduce<FocusPoint | undefined>(
    (best, f) => (best === undefined || f.weight > best.weight ? f : best),
    undefined,
  )
  const pos = focus?.pos ?? { x: 0.5, y: 0.5 }
  return { x: box.x + pos.x * box.w, y: box.y + pos.y * box.h }
}

/** p が、c を中心に横の半径 rx・縦の半径 ry の楕円の内側（縁を含まない）にあるか */
export const insideEllipse = (p: Point, c: Point, rx: number, ry: number): boolean =>
  ((p.x - c.x) / rx) ** 2 + ((p.y - c.y) / ry) ** 2 < 1
