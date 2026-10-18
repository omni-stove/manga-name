import { m } from '@manga/i18n'
import type { FocusDiagnosis, Panel, Point } from '@manga/schema'

/** フキダシを焦点とみなすときの weight（04 の 0 節） */
const BUBBLE_WEIGHT = 0.4

/** FocusPoint とフキダシの合成焦点を同じ形で扱うための焦点 */
export type Focus = {
  id: string
  kind: FocusDiagnosis['kind']
  label: string
  pos: Point
  weight: number
}

/** Panel の焦点を FocusPoint、Bubble（order 順）の順で返す。入力は変更しない */
export const panelFoci = (panel: Panel): Focus[] => [
  ...panel.focusPoints.map((fp) => ({
    id: fp.id,
    kind: fp.kind,
    label: fp.label,
    pos: fp.pos,
    weight: fp.weight,
  })),
  ...[...panel.bubbles]
    .sort((a, b) => a.order - b.order)
    .map((b) => ({
      id: b.id,
      kind: 'bubble' as const,
      // 合成焦点の label（04 の 10 節）。セリフ本文はヒントや Issue に出さない
      label: m.diagnosis_bubble_label(),
      pos: b.pos,
      weight: BUBBLE_WEIGHT,
    })),
]

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  const bubble = (id: string, order: number, x: number) =>
    ({
      id,
      order,
      text: 'secret line',
      shape: 'normal',
      pos: { x, y: 0.5 },
      size: { w: 0.1, h: 0.1 },
    }) as const

  const panel = {
    id: 'pn',
    order: 1,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    bubbles: [bubble('bb_2', 2, 0.2), bubble('bb_1', 1, 0.8)],
    focusPoints: [
      {
        id: 'fp',
        kind: 'face',
        label: 'E',
        pos: { x: 0.5, y: 0.5 },
        weight: 0.7,
        characterId: 'chr',
      },
    ],
    vectors: [],
    arts: [],
  } satisfies Panel

  test('focus points come first, then bubbles in order with the fixed weight and label', () => {
    expect(panelFoci(panel)).toEqual([
      { id: 'fp', kind: 'face', label: 'E', pos: { x: 0.5, y: 0.5 }, weight: 0.7 },
      { id: 'bb_1', kind: 'bubble', label: 'フキダシ', pos: { x: 0.8, y: 0.5 }, weight: 0.4 },
      { id: 'bb_2', kind: 'bubble', label: 'フキダシ', pos: { x: 0.2, y: 0.5 }, weight: 0.4 },
    ])
  })

  test('does not reorder the bubbles of the input', () => {
    panelFoci(panel)
    expect(panel.bubbles.map((b) => b.id)).toEqual(['bb_2', 'bb_1'])
  })
}
