import type { FocusPoint, Panel } from './project'

/** 描き文字の書体 */
export const SFX_TYPEFACE = 'bold'

/** 描き文字の文字の高さ。コマの短辺に対する比率で、weight 0 で MIN、1 で MAX */
const SFX_FONT_MIN = 0.08
const SFX_FONT_MAX = 0.25

/** 描き文字の白いふちの線の太さ。文字の高さに対する比率。線の半分が字の外に出る */
export const SFX_OUTLINE = 0.2

/** 紙面に描き文字として描く焦点。label が空白だけの sfx と、face と keyObject の焦点は描かない */
export function sfxLetterings(panel: Pick<Panel, 'focusPoints'>): FocusPoint[] {
  return panel.focusPoints.filter((f) => f.kind === 'sfx' && f.label.trim() !== '')
}

/** 描き文字の文字の高さ。w と h はコマの矩形の大きさで、返す値も同じ単位 */
export function sfxFontSize(weight: number, w: number, h: number): number {
  return Math.min(w, h) * (SFX_FONT_MIN + (SFX_FONT_MAX - SFX_FONT_MIN) * weight)
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const focus = (patch: Partial<FocusPoint>): FocusPoint => ({
    id: 'fp_1',
    kind: 'sfx',
    label: 'ドン',
    pos: { x: 0.5, y: 0.5 },
    weight: 0.5,
    ...patch,
  })

  test('sfxLetterings keeps only sfx focus points with a label', () => {
    const sfx = focus({})
    const focusPoints = [
      sfx,
      focus({ id: 'fp_2', label: '' }),
      focus({ id: 'fp_3', label: ' \n' }),
      focus({ id: 'fp_4', kind: 'face' }),
      focus({ id: 'fp_5', kind: 'keyObject' }),
    ]
    expect(sfxLetterings({ focusPoints })).toEqual([sfx])
  })

  test('sfxFontSize scales with weight from 0.08 to 0.25 of the short side', () => {
    expect(sfxFontSize(0, 200, 100)).toBeCloseTo(8)
    expect(sfxFontSize(1, 200, 100)).toBeCloseTo(25)
    expect(sfxFontSize(0.5, 100, 300)).toBeCloseTo(16.5)
  })
}
