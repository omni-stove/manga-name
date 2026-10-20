/** 縦中横に組む 2 字の組。半角か全角の感嘆符・疑問符 2 つ、半角数字 2 桁 */
const UPRIGHT = /^(?:[!?！？]{2}|[0-9]{2})$/

const MARK = /^[!?！？]$/
const DIGIT = /^[0-9]$/

/** 縦書きで、その字（combineUpright がまとめた組）を 1 字分の幅に横に並べて組むか */
export function isUpright(glyph: string): boolean {
  return UPRIGHT.test(glyph)
}

/**
 * 縦書きの書記素の列のうち、縦中横に組む 2 字の組を 1 つの字にまとめる。
 * 同じ種類の字がちょうど 2 つ続く所だけをまとめ、3 字以上続く所はまとめない
 */
export function combineUpright(glyphs: readonly string[]): string[] {
  const kind = (glyph: string | undefined) =>
    glyph === undefined ? undefined : MARK.test(glyph) ? 'mark' : DIGIT.test(glyph) ? 'digit' : undefined
  const combined: string[] = []
  let i = 0
  while (i < glyphs.length) {
    const k = kind(glyphs[i])
    let end = i + 1
    while (k !== undefined && end < glyphs.length && kind(glyphs[end]) === k) end++
    if (end - i === 2) combined.push(glyphs.slice(i, end).join(''))
    else combined.push(...glyphs.slice(i, end))
    i = end
  }
  return combined
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('pairs of marks and two-digit numbers become one upright glyph', () => {
    expect(combineUpright(Array.from('え!?'))).toEqual(['え', '!?'])
    expect(combineUpright(Array.from('！！ね？！'))).toEqual(['！！', 'ね', '？！'])
    expect(combineUpright(Array.from('12月'))).toEqual(['12', '月'])
    expect(combineUpright(Array.from('3時!?'))).toEqual(['3', '時', '!?'])
  })

  test('runs of three or more are left as they are', () => {
    expect(combineUpright(Array.from('100円'))).toEqual(['1', '0', '0', '円'])
    expect(combineUpright(Array.from('!!!'))).toEqual(['!', '!', '!'])
  })

  test('a digit next to a mark does not pair with it', () => {
    expect(combineUpright(Array.from('1!'))).toEqual(['1', '!'])
  })

  test('isUpright tells combined pairs from single glyphs', () => {
    expect(isUpright('!?')).toBe(true)
    expect(isUpright('？？')).toBe(true)
    expect(isUpright('42')).toBe(true)
    expect(isUpright('!')).toBe(false)
    expect(isUpright('7')).toBe(false)
    expect(isUpright('あ')).toBe(false)
  })
}
