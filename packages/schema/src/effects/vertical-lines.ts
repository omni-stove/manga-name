import type { Panel, Point, Rect } from '../project'

/**
 * 縦線（vertical_lines）の効果線を、塗りつぶす多角形の列で返す。引数と返す座標の単位は effectLines と同じで、
 * random はコマの id を種にした擬似乱数。まだ形を持たないので空を返す
 */
export function verticalLines(
  _panel: Pick<Panel, 'id' | 'focusPoints' | 'vectors'>,
  _box: Rect,
  _unit: number,
  _random: () => number,
): Point[][] {
  return []
}
