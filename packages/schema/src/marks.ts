import type { FocusKind, FocusMark, FocusPoint, Panel, Point, Rect } from './project'

/** 漫符の種類の既定 */
export const DEFAULT_MARK: FocusMark = 'sweat'

/**
 * 画面で選べる焦点の種類。生成のための印で紙面に描かない face と keyObject、紙面に描ける sfx を並べ、
 * 描くと空になる mark を選ばせない
 */
export const AVAILABLE_FOCUS_KINDS = [
  'face',
  'keyObject',
  'sfx',
] as const satisfies readonly FocusKind[]

/** 漫符の種類。指定が無ければ DEFAULT_MARK */
export function focusMark(focus: Pick<FocusPoint, 'mark'>): FocusMark {
  return focus.mark ?? DEFAULT_MARK
}

/**
 * コマの漫符（kind が mark の焦点）を、塗りつぶす多角形の列で返す。box はコマの rect を描く先の単位にした矩形、
 * unit は 1 ページの幅で、返す頂点も同じ単位。漫符はコマの輪郭の外まで出ることがあるので、呼び出し側が輪郭で切る。
 * 塗る色は効果線と同じ effectInk
 */
export function markShapes(
  panel: Pick<Panel, 'id' | 'focusPoints'>,
  box: Rect,
  unit: number,
): Point[][] {
  if (box.w <= 0 || box.h <= 0) return []
  return panel.focusPoints
    .filter((f) => f.kind === 'mark')
    .flatMap((f) => markPolygons(focusMark(f), f, box, unit))
}

/** 1 つの漫符の多角形。まだ形を持たないので空を返す */
function markPolygons(_mark: FocusMark, _focus: FocusPoint, _box: Rect, _unit: number): Point[][] {
  return []
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const focus = (patch: Partial<FocusPoint>): FocusPoint => ({
    id: 'fp_1',
    kind: 'mark',
    label: '',
    pos: { x: 0.5, y: 0.5 },
    weight: 0.5,
    ...patch,
  })
  const box: Rect = { x: 10, y: 20, w: 100, h: 50 }

  test('focusMark falls back to sweat', () => {
    expect(focusMark({})).toBe('sweat')
    expect(focusMark({ mark: 'anger' })).toBe('anger')
  })

  test('markShapes draws nothing yet, for every mark and for the other kinds', () => {
    const focusPoints = [
      focus({}),
      ...(['sweat', 'anger', 'question', 'exclaim', 'sigh'] as const).map((mark) =>
        focus({ id: `fp_${mark}`, mark }),
      ),
      focus({ id: 'fp_sfx', kind: 'sfx', label: 'ドン' }),
    ]
    expect(markShapes({ id: 'pn', focusPoints }, box, 100)).toEqual([])
  })
}
