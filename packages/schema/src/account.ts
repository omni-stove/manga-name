import { z } from 'zod'

/** 表示名の最大文字数。参加者一覧と presence で並べて読める長さ */
export const DISPLAY_NAME_MAX_LENGTH = 40

/** 参加者一覧などで他のユーザーに見える名前。前後の空白を落とし、空は認めない */
export const DisplayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH)

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('trims and accepts 1 to 40 characters', () => {
    expect(DisplayNameSchema.parse('  ペンネーム ')).toBe('ペンネーム')
    expect(DisplayNameSchema.safeParse('あ'.repeat(40)).success).toBe(true)
    expect(DisplayNameSchema.safeParse('あ'.repeat(41)).success).toBe(false)
    expect(DisplayNameSchema.safeParse('   ').success).toBe(false)
  })
}
