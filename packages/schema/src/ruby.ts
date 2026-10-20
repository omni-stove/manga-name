/**
 * セリフの一続き。ruby があれば base 全体にそのルビを振り、emphasis なら base の 1 字ずつに傍点を打つ。
 * ルビと傍点は同じ一続きに重ならない
 */
export interface RubySpan {
  base: string
  ruby?: string
  emphasis?: true
}

// 青空文庫やなろうの書式に倣い、親文字の始まりは縦棒で明示させる。全角の縦棒も打ちやすさのため受け付ける
const RUBY = /[|｜]([^|｜《》\n]+)《([^《》\n]+)》/g

const EMPHASIS_OPEN = '《《'
const EMPHASIS_CLOSE = '》》'
const EMPHASIS_MARK = /(《《|》》)/

type Token = RubySpan | typeof EMPHASIS_OPEN | typeof EMPHASIS_CLOSE

function parseRubyOnly(text: string): RubySpan[] {
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

// ルビを先に解くのは、`《《|語《ご》》》` でルビの閉じの》と傍点の》》が続いて、傍点の閉じを取り違えないようにするため
function tokenize(text: string): Token[] {
  return parseRubyOnly(text).flatMap((span): Token[] =>
    span.ruby !== undefined
      ? [span]
      : span.base
          .split(EMPHASIS_MARK)
          .filter((piece) => piece !== '')
          .map((piece) =>
            piece === EMPHASIS_OPEN || piece === EMPHASIS_CLOSE ? piece : { base: piece },
          ),
  )
}

/** tokens[open] の《《と対になる》》の位置。間が空か、改行か別の《《を挟むなら対にせず -1 */
function findClose(tokens: readonly Token[], open: number): number {
  for (let i = open + 1; i < tokens.length; i++) {
    const token = tokens[i] as Token
    if (token === EMPHASIS_CLOSE) return i > open + 1 ? i : -1
    if (token === EMPHASIS_OPEN || token.base.includes('\n')) return -1
  }
  return -1
}

/**
 * `|単語《ルビ》` の書式でルビを振り、`《《語》》` の書式で傍点を打ったセリフを、地の文とルビ付きの語と
 * 傍点付きの語に順に分ける。傍点の中のルビ付きの語はルビを優先し、傍点を打たない。
 * 書式に合わない縦棒や二重山括弧は地の文にそのまま残す。空の地の文は返さない
 */
export function parseRuby(text: string): RubySpan[] {
  const spans: RubySpan[] = []
  const push = (span: RubySpan) => {
    const prev = spans[spans.length - 1]
    if (
      prev &&
      prev.ruby === undefined &&
      span.ruby === undefined &&
      prev.emphasis === span.emphasis
    ) {
      prev.base += span.base
    } else {
      spans.push({ ...span })
    }
  }
  const tokens = tokenize(text)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token
    const close = token === EMPHASIS_OPEN ? findClose(tokens, i) : -1
    if (close === -1) {
      push(typeof token === 'string' ? { base: token } : token)
      continue
    }
    for (const inner of tokens.slice(i + 1, close) as RubySpan[]) {
      push(inner.ruby === undefined ? { base: inner.base, emphasis: true } : inner)
    }
    i = close
  }
  return spans
}

/** ルビと傍点の書式を除き、親文字だけを残したセリフ */
export function stripRuby(text: string): string {
  return parseRuby(text)
    .map((span) => span.base)
    .join('')
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
    expect(stripRuby('《《本当》》に|魔法《まほう》だ\n《《ね')).toBe('本当に魔法だ\n《《ね')
  })

  test('parseRuby marks the base of 《《語》》 with emphasis', () => {
    expect(parseRuby('それは《《本当》》だ')).toEqual([
      { base: 'それは' },
      { base: '本当', emphasis: true },
      { base: 'だ' },
    ])
  })

  test('ruby inside emphasis wins and its base gets no emphasis', () => {
    expect(parseRuby('《《この|魔法《まほう》だ》》')).toEqual([
      { base: 'この', emphasis: true },
      { base: '魔法', ruby: 'まほう' },
      { base: 'だ', emphasis: true },
    ])
    expect(parseRuby('《《|魔法《まほう》》》')).toEqual([{ base: '魔法', ruby: 'まほう' }])
  })

  test('emphasis marks without a pair stay as plain text', () => {
    expect(parseRuby('《《まだ')).toEqual([{ base: '《《まだ' }])
    expect(parseRuby('まだ》》')).toEqual([{ base: 'まだ》》' }])
    expect(parseRuby('《《》》')).toEqual([{ base: '《《》》' }])
    expect(parseRuby('《《あ\nい》》')).toEqual([{ base: '《《あ\nい》》' }])
    expect(parseRuby('《《あ《《い》》')).toEqual([
      { base: '《《あ' },
      { base: 'い', emphasis: true },
    ])
  })
}
