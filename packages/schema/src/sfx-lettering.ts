import type { Bubble, FocusPoint, Panel } from './project'

/** 描き文字の書体の既定 */
export const SFX_TYPEFACE: NonNullable<Bubble['typeface']> = 'bold'

/** 描き文字の文字の高さ。コマの短辺に対する比率で、weight 0 で MIN、1 で MAX */
const SFX_FONT_MIN = 0.08
const SFX_FONT_MAX = 0.25

/** FocusPoint.scale に取れる範囲 */
export const SFX_SCALE_MIN = 0.25
export const SFX_SCALE_MAX = 4

/** 描き文字の白いふちの線の太さ。文字の高さに対する比率。線の半分が字の外に出る */
export const SFX_OUTLINE = 0.2

/** 紙面に描き文字として描く焦点。label が空白だけの sfx と、face と keyObject の焦点は描かない */
export function sfxLetterings(panel: Pick<Panel, 'focusPoints'>): FocusPoint[] {
  return panel.focusPoints.filter((f) => f.kind === 'sfx' && f.label.trim() !== '')
}

/** 描き文字の書体。指定が無ければ SFX_TYPEFACE */
export function sfxTypeface(focus: Pick<FocusPoint, 'typeface'>): NonNullable<Bubble['typeface']> {
  return focus.typeface ?? SFX_TYPEFACE
}

/**
 * 描き文字の文字の高さ。weight から決めた高さに scale を掛ける。
 * w と h はコマの矩形の大きさで、返す値も同じ単位
 */
export function sfxFontSize(
  focus: Pick<FocusPoint, 'weight' | 'scale'>,
  w: number,
  h: number,
): number {
  const base = Math.min(w, h) * (SFX_FONT_MIN + (SFX_FONT_MAX - SFX_FONT_MIN) * focus.weight)
  return base * (focus.scale ?? 1)
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
    expect(sfxFontSize({ weight: 0 }, 200, 100)).toBeCloseTo(8)
    expect(sfxFontSize({ weight: 1 }, 200, 100)).toBeCloseTo(25)
    expect(sfxFontSize({ weight: 0.5 }, 100, 300)).toBeCloseTo(16.5)
  })

  test('sfxFontSize multiplies the size from weight by scale', () => {
    expect(sfxFontSize({ weight: 1, scale: 2 }, 200, 100)).toBeCloseTo(50)
    expect(sfxFontSize({ weight: 0, scale: 0.5 }, 200, 100)).toBeCloseTo(4)
  })

  test('sfxTypeface falls back to bold', () => {
    expect(sfxTypeface({})).toBe('bold')
    expect(sfxTypeface({ typeface: 'hand' })).toBe('hand')
  })
}
