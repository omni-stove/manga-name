import type { BubbleGeometry, BubbleOutline } from './bubble-outline'
import type { Bubble } from './project'

/** 声の調子を輪郭で表すフキダシの形。cold は角の尖った冷たい声、weak はしぼんだ弱々しい声 */
export type BubbleMood = Extract<Bubble['shape'], 'cold' | 'weak'>

const MOODS: readonly Bubble['shape'][] = ['cold', 'weak'] satisfies BubbleMood[]

export const isBubbleMood = (shape: Bubble['shape']): shape is BubbleMood => MOODS.includes(shape)

/**
 * mood の形で g に置いたフキダシの描き方。normal は同じ g に置いた普通のフキダシの描き方で、
 * 輪郭を崩す元にする。まだ形を持たないので normal をそのまま返す
 */
export function moodOutline(
  _mood: BubbleMood,
  _g: BubbleGeometry,
  normal: BubbleOutline,
): BubbleOutline {
  return normal
}
