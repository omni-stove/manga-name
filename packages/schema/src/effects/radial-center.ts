import type { Panel, Point, Rect } from '../project'
import { focusCenter } from './focus'

/**
 * 焦点のある効果の中心（weight が最大の焦点、無ければコマの中心）と、そこから最も遠い角まで届く長さ。
 * box と返す座標は effectLines と同じ単位
 */
export function radialCenter(
  panel: Pick<Panel, 'focusPoints'>,
  box: Rect,
): { c: Point; reach: number } {
  const c = focusCenter(panel, box)
  // 焦点がコマの端にあっても反対側の角まで届く長さ
  const reach =
    Math.max(
      ...[box.x, box.x + box.w].flatMap((x) =>
        [box.y, box.y + box.h].map((y) => Math.hypot(x - c.x, y - c.y)),
      ),
    ) * 1.05
  return { c, reach }
}
