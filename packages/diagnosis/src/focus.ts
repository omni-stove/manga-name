import type { FocusDiagnosis, Panel, Point } from '@manga/schema'

/** フキダシを焦点とみなすときの weight（04 の 0 節） */
const BUBBLE_WEIGHT = 0.4

/** 合成焦点の label（04 の 10 節）。セリフ本文はヒントや Issue に出さない */
const BUBBLE_LABEL = 'フキダシ'

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
      label: BUBBLE_LABEL,
      pos: b.pos,
      weight: BUBBLE_WEIGHT,
    })),
]
