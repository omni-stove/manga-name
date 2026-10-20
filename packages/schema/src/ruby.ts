/** セリフの一続き。ruby があれば base 全体にそのルビを振る */
export interface RubySpan {
  base: string
  ruby?: string
}

// 青空文庫やなろうの書式に倣い、親文字の始まりは縦棒で明示させる。全角の縦棒も打ちやすさのため受け付ける
const RUBY = /[|｜]([^|｜《》\n]+)《([^《》\n]+)》/g

/**
 * `|単語《ルビ》` の書式でルビを振ったセリフを、地の文とルビ付きの語に順に分ける。
 * 書式に合わない縦棒や二重山括弧は地の文にそのまま残す。空の地の文は返さない
 */
export function parseRuby(text: string): RubySpan[] {
  const spans: RubySpan[] = []
  let last = 0
  for (const match of text.matchAll(RUBY)) {
    if (match.index > last) spans.push({ base: text.slice(last, match.index) })
    spans.push({ base: match[1] as string, ruby: match[2] as string })
    last = match.index + match[0].length
  }
  if (last < text.length) spans.push({ base: text.slice(last) })
  return spans
}

/** ルビの書式を除き、親文字だけを残したセリフ */
export function stripRuby(text: string): string {
  return text.replace(RUBY, '$1')
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('parseRuby splits plain text and ruby spans in order', () => {
    expect(parseRuby('この|魔法陣《まほうじん》は｜禁忌《タブー》だ')).toEqual([
      { base: 'この' },
      { base: '魔法陣', ruby: 'まほうじん' },
      { base: 'は' },
      { base: '禁忌', ruby: 'タブー' },
      { base: 'だ' },
    ])
  })

  test('marks that do not form the format stay as plain text', () => {
    expect(parseRuby('a|b')).toEqual([{ base: 'a|b' }])
    expect(parseRuby('《る》だけ')).toEqual([{ base: '《る》だけ' }])
    expect(parseRuby('|《る》')).toEqual([{ base: '|《る》' }])
    expect(parseRuby('|あ\nい《る》')).toEqual([{ base: '|あ\nい《る》' }])
    expect(parseRuby('')).toEqual([])
  })

  test('stripRuby keeps only the base text', () => {
    expect(stripRuby('この|魔法陣《まほうじん》は｜禁忌《タブー》だ')).toBe('この魔法陣は禁忌だ')
  })
}
