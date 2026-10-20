import { type Bubble, parseRuby } from '@manga/schema'

/** 行（縦書きの 1 列、横書きの 1 行）の間隔。文字サイズに対する比率 */
const COLUMN_PITCH = 1.2
/** ルビの文字サイズ。親文字に対する比率 */
export const RUBY_SCALE = 0.5
/** 傍点の字。大きさと位置はルビに揃える */
export const EMPHASIS_MARK = '﹅'
/** 文字サイズの上限と下限（mm）。下限でも収まらなければ末尾を省略する */
const MAX_FONT = 6
const MIN_FONT = 2
const FONT_STEP = 0.25
const ELLIPSIS = '…'
/** 横書きで続けて書く間は割らない、英単語の字 */
const LATIN_WORD = /^[A-Za-z0-9'’.,!?;:-]$/
/** 横書きで半分の幅とみなす字。半角の英数字・記号と半角カナ */
const HALF_WIDTH = /^[\x20-\x7e｡-ﾟ]$/
const SPACE = /^\s$/u

/** 行の中で、行頭から start の位置の親文字 length の長さに振るルビ。長さは文字サイズ単位 */
interface LineRuby {
  start: number
  length: number
  text: string
}

interface TextLine {
  text: string
  /** 行の向きの長さ（文字サイズ単位）。縦書きでは字数 */
  length: number
  rubies: LineRuby[]
  /** 傍点を打つ親文字の、行頭から字の中心までの長さ（文字サイズ単位） */
  marks: number[]
  /** 組みの右端（横書きでは上端）から、この行の親文字の中心までの距離（mm） */
  offset: number
}

export interface TextLayout {
  /** 縦書きは右から、横書きは上から順の行 */
  lines: TextLine[]
  /** 行を送る向きの、組み全体の幅（mm）。縦書きでは横幅、横書きでは高さ */
  thickness: number
  /** 文字サイズ（mm） */
  fontSize: number
  /** 収まらずに末尾を省略したか */
  truncated: boolean
}

/**
 * 行の中で割らない一続き。ルビを振った語は語ごと、横書きでは英単語も語ごとにまとめ、傍点を打った語は 1 字ずつにする
 */
interface Unit {
  glyphs: string[]
  ruby?: string
  emphasis?: true
}

/** 1 字が行の向きに進む長さ（文字サイズ単位） */
type Advance = (glyph: string) => number

const squareAdvance: Advance = () => 1
const halfWidthAdvance: Advance = (glyph) => (HALF_WIDTH.test(glyph) ? 0.5 : 1)

let segmenter: Intl.Segmenter | undefined

function graphemes(text: string): string[] {
  if (!segmenter) segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

function joinWords(glyphs: string[]): Unit[] {
  const units: Unit[] = []
  for (const glyph of glyphs) {
    const last = units[units.length - 1]
    if (last && LATIN_WORD.test(glyph) && LATIN_WORD.test(last.glyphs.at(-1) ?? '')) {
      last.glyphs.push(glyph)
    } else {
      units.push({ glyphs: [glyph] })
    }
  }
  return units
}

function toParagraphs(text: string, horizontal: boolean): Unit[][] {
  return text.split('\n').map((p) =>
    parseRuby(p).flatMap(({ base, ruby, emphasis }): Unit[] => {
      if (ruby !== undefined) return [{ glyphs: graphemes(base), ruby }]
      const glyphs = graphemes(base)
      if (emphasis) return glyphs.map((glyph) => ({ glyphs: [glyph], emphasis }))
      return horizontal ? joinWords(glyphs) : glyphs.map((glyph) => ({ glyphs: [glyph] }))
    }),
  )
}

const unitLength = (unit: Unit, advance: Advance) =>
  unit.glyphs.reduce((n, glyph) => n + advance(glyph), 0)

const lineLength = (units: readonly Unit[], advance: Advance) =>
  units.reduce((n, u) => n + unitLength(u, advance), 0)

const isSpace = (unit: Unit | undefined) =>
  unit !== undefined && !unit.ruby && unit.glyphs.every((glyph) => SPACE.test(glyph))

/**
 * perLine（文字サイズ単位）の長さごとに折り返す。trimSpaces なら折り返した所の空白を行末から除き、次の行頭にも置かない。
 * 英文の語の間の空白で行が中央からずれないように
 */
function breakLines(
  paragraphs: Unit[][],
  perLine: number,
  advance: Advance,
  trimSpaces: boolean,
): Unit[][] {
  const lines: Unit[][] = []
  for (const units of paragraphs) {
    let line: Unit[] = []
    for (const unit of units) {
      if (line.length > 0 && lineLength(line, advance) + unitLength(unit, advance) > perLine) {
        if (trimSpaces) {
          while (line.length > 1 && isSpace(line[line.length - 1])) line.pop()
        }
        lines.push(line)
        line = []
        if (trimSpaces && isSpace(unit)) continue
      }
      line.push(unit)
    }
    lines.push(line)
  }
  return lines
}

/** ルビを振った語や英単語を割らないので、行が perLine を超えうる。長さに収まるかを別に確かめる */
function fitsLength(
  lines: readonly Unit[][],
  advance: Advance,
  fontSize: number,
  length: number,
): boolean {
  return lines.every((line) => lineLength(line, advance) * fontSize <= length)
}

const lineThickness = (line: readonly Unit[], fontSize: number) =>
  line.some((u) => u.ruby || u.emphasis) ? fontSize * (1 + RUBY_SCALE) : fontSize

function blockThickness(lines: readonly Unit[][], fontSize: number): number {
  if (lines.length === 0) return 0
  const sum = lines.reduce((n, line) => n + lineThickness(line, fontSize), 0)
  return sum + (lines.length - 1) * fontSize * (COLUMN_PITCH - 1)
}

function toLayout(
  lines: Unit[][],
  advance: Advance,
  fontSize: number,
  truncated: boolean,
): TextLayout {
  let edge = 0
  const placed = lines.map((units) => {
    const thickness = lineThickness(units, fontSize)
    const offset = edge + thickness - fontSize / 2
    edge += thickness + fontSize * (COLUMN_PITCH - 1)
    const rubies: LineRuby[] = []
    const marks: number[] = []
    let start = 0
    for (const u of units) {
      const length = unitLength(u, advance)
      if (u.ruby) rubies.push({ start, length, text: u.ruby })
      if (u.emphasis) marks.push(start + length / 2)
      start += length
    }
    return {
      text: units.flatMap((u) => u.glyphs).join(''),
      length: start,
      rubies,
      marks,
      offset,
    }
  })
  return { lines: placed, thickness: blockThickness(lines, fontSize), fontSize, truncated }
}

/**
 * セリフを w x h（mm）の箱に割り付ける。writing が horizontal なら横書きで、半角の字を文字サイズの半分の幅とみなし、
 * 英単語を割らない。省略は縦書き。`|単語《ルビ》` のルビは語ごと同じ行に置き、`《《語》》` の傍点は 1 字ずつ行をまたいで割れる。
 * 収まる最大の文字サイズを選び、MIN_FONT でも収まらなければ収まる行数で切り、最後の字を省略記号にする。
 * 禁則、ルビによる親文字のあけ、書体ごとの字の幅は扱わない（レンダラと折り返し位置まで揃える必要はない）
 */
export function layoutText(
  text: string,
  box: { w: number; h: number },
  writing?: Bubble['writing'],
): TextLayout {
  const horizontal = writing === 'horizontal'
  const advance = horizontal ? halfWidthAdvance : squareAdvance
  // 行の向きの長さと、行を送る向きの幅
  const along = horizontal ? box.w : box.h
  const across = horizontal ? box.h : box.w
  const paragraphs = toParagraphs(text, horizontal)
  if (paragraphs.every((p) => p.length === 0)) {
    return { lines: [], thickness: 0, fontSize: MIN_FONT, truncated: false }
  }
  const max = Math.min(MAX_FONT, box.w, box.h)
  for (let fontSize = max; fontSize >= MIN_FONT; fontSize -= FONT_STEP) {
    const lines = breakLines(paragraphs, along / fontSize, advance, horizontal)
    const fits = fitsLength(lines, advance, fontSize, along)
    if (fits && blockThickness(lines, fontSize) <= across) {
      return toLayout(lines, advance, fontSize, false)
    }
  }
  const fontSize = MIN_FONT
  const perLine = Math.max(1, along / fontSize)
  const all = breakLines(paragraphs, perLine, advance, horizontal)
  let fit = 1
  while (fit < all.length && blockThickness(all.slice(0, fit + 1), fontSize) <= across) fit++
  if (all.length <= fit && fitsLength(all, advance, fontSize, along)) {
    return toLayout(all, advance, fontSize, false)
  }
  const kept = all.slice(0, fit)
  const last = kept[kept.length - 1] ?? []
  const ellipsis = { glyphs: [ELLIPSIS] }
  kept[kept.length - 1] =
    lineLength(last, advance) + advance(ELLIPSIS) > perLine
      ? [...last.slice(0, -1), ellipsis]
      : [...last, ellipsis]
  return toLayout(kept, advance, fontSize, true)
}

/** 折り返さずに改行でだけ列を分け、fontSize（mm）で縦書きに組む。描き文字のように文字サイズが先に決まっている文に使う */
export function layoutUnbroken(text: string, fontSize: number): TextLayout {
  return toLayout(toParagraphs(text, false), squareAdvance, fontSize, false)
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const texts = (layout: TextLayout) => layout.lines.map((c) => c.text)

  test('short text fits in one column at the largest size', () => {
    expect(layoutText('……芽が', { w: 10, h: 40 })).toEqual({
      lines: [{ text: '……芽が', length: 4, rubies: [], marks: [], offset: 3 }],
      thickness: 6,
      fontSize: 6,
      truncated: false,
    })
  })

  test('long text wraps into columns from the right', () => {
    const layout = layoutText('あいうえおかきくけこ', { w: 12, h: 15 })
    expect(layout.truncated).toBe(false)
    expect(texts(layout).join('')).toBe('あいうえおかきくけこ')
    expect(layout.lines.length).toBeGreaterThan(1)
  })

  test('newlines start a new column', () => {
    expect(texts(layoutText('あ\nい', { w: 20, h: 20 }))).toEqual(['あ', 'い'])
  })

  test('overflow is cut and ends with an ellipsis', () => {
    const layout = layoutText('あ'.repeat(100), { w: 5, h: 10 })
    expect(layout.truncated).toBe(true)
    expect(layout.fontSize).toBe(MIN_FONT)
    expect(layout.lines).toHaveLength(2)
    expect(layout.lines.at(-1)?.text).toBe('ああああ…')
  })

  test('empty text has no columns', () => {
    expect(layoutText('', { w: 10, h: 10 }).lines).toEqual([])
  })

  test('ruby stays on the column of its base and widens that column', () => {
    const layout = layoutText('あ|魔法《まほう》\nい', { w: 30, h: 18 })
    expect(layout.fontSize).toBe(6)
    expect(layout.lines).toEqual([
      {
        text: 'あ魔法',
        length: 3,
        rubies: [{ start: 1, length: 2, text: 'まほう' }],
        marks: [],
        offset: 6,
      },
      { text: 'い', length: 1, rubies: [], marks: [], offset: 9 + 1.2 + 3 },
    ])
    expect(layout.thickness).toBeCloseTo(9 + 1.2 + 6)
  })

  test('layoutUnbroken keeps the given size and breaks only at newlines', () => {
    const layout = layoutUnbroken('ゴゴゴゴゴゴゴゴ\nゴ', 10)
    expect(layout.fontSize).toBe(10)
    expect(texts(layout)).toEqual(['ゴゴゴゴゴゴゴゴ', 'ゴ'])
    expect(layout.thickness).toBeCloseTo(10 + 2 + 10)
  })

  test('a ruby word moves to the next column as a whole', () => {
    expect(texts(layoutText('あい|魔法《まほう》', { w: 30, h: 18 }))).toEqual(['あい', '魔法'])
  })

  test('horizontal text wraps by the width of the box into lines from the top', () => {
    const layout = layoutText('あいうえおかきくけこ', { w: 15, h: 12 }, 'horizontal')
    expect(layout.truncated).toBe(false)
    expect(texts(layout).join('')).toBe('あいうえおかきくけこ')
    expect(layout.lines.length).toBeGreaterThan(1)
    expect(layout.thickness).toBeLessThanOrEqual(12)
    for (const line of layout.lines) expect(line.length * layout.fontSize).toBeLessThanOrEqual(15)
  })

  test('horizontal half-width letters are half wide, and words stay whole', () => {
    expect(layoutText('Hello world', { w: 15, h: 30 }, 'horizontal')).toMatchObject({
      lines: [
        { text: 'Hello', length: 2.5 },
        { text: 'world', length: 2.5 },
      ],
      fontSize: 6,
    })
  })

  test('horizontal ruby goes above its base and thickens that line', () => {
    expect(layoutText('あ|魔法《まほう》', { w: 18, h: 30 }, 'horizontal')).toEqual({
      lines: [
        {
          text: 'あ魔法',
          length: 3,
          rubies: [{ start: 1, length: 2, text: 'まほう' }],
          marks: [],
          offset: 6,
        },
      ],
      thickness: 9,
      fontSize: 6,
      truncated: false,
    })
  })

  test('emphasis marks are dropped, widen the column and skip ruby words', () => {
    const layout = layoutText('あ《《本当|魔法《まほう》だ》》\nい', { w: 30, h: 36 })
    expect(layout.fontSize).toBe(6)
    expect(layout.lines).toEqual([
      {
        text: 'あ本当魔法だ',
        length: 6,
        rubies: [{ start: 3, length: 2, text: 'まほう' }],
        marks: [1.5, 2.5, 5.5],
        offset: 6,
      },
      { text: 'い', length: 1, rubies: [], marks: [], offset: 9 + 1.2 + 3 },
    ])
  })

  test('an emphasized word can wrap across columns', () => {
    const layout = layoutText('《《あいう》》', { w: 30, h: 12 })
    expect(layout.fontSize).toBe(6)
    expect(layout.lines.map((c) => [c.text, c.marks])).toEqual([
      ['あい', [0.5, 1.5]],
      ['う', [0.5]],
    ])
  })

  test('horizontal emphasis marks sit over each glyph, half-width ones included', () => {
    expect(layoutText('《《本A》》', { w: 30, h: 30 }, 'horizontal').lines).toMatchObject([
      { text: '本A', length: 1.5, marks: [0.5, 1.25] },
    ])
  })
}
