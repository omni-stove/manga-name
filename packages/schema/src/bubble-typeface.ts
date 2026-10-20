import type { Bubble } from './project'

type Typeface = NonNullable<Bubble['typeface']>

/** 書体を指定しないフキダシの、形ごとの書体。手書き風は指定したときだけ使う */
const SHAPE_TYPEFACE: Record<Bubble['shape'], Typeface> = {
  normal: 'gothic',
  shout: 'bold',
  thought: 'gothic',
  whisper: 'gothic',
  tremble: 'gothic',
  electronic: 'rounded',
  urchin: 'bold',
  narration: 'mincho',
  monologue: 'gothic',
  none: 'gothic',
}

/**
 * セリフを描く書体。指定が無ければ形から決める。叫びとウニフラは太ゴシック、ナレーションは明朝、
 * 電子音は丸ゴシック、ほかはゴシック
 */
export function bubbleTypeface(bubble: Pick<Bubble, 'shape' | 'typeface'>): Typeface {
  return bubble.typeface ?? SHAPE_TYPEFACE[bubble.shape]
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('bubbleTypeface follows the shape unless the bubble names a typeface', () => {
    expect(bubbleTypeface({ shape: 'normal' })).toBe('gothic')
    expect(bubbleTypeface({ shape: 'narration' })).toBe('mincho')
    expect(bubbleTypeface({ shape: 'monologue' })).toBe('gothic')
    expect(bubbleTypeface({ shape: 'shout' })).toBe('bold')
    expect(bubbleTypeface({ shape: 'electronic' })).toBe('rounded')
    expect(bubbleTypeface({ shape: 'narration', typeface: 'gothic' })).toBe('gothic')
    expect(bubbleTypeface({ shape: 'whisper', typeface: 'hand' })).toBe('hand')
  })
}
