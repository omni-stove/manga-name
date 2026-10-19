import { parseRuby } from '@manga/schema'

/** 縦書きの行（1 列）の間隔。文字サイズに対する比率 */
const COLUMN_PITCH = 1.2
/** ルビの文字サイズ。親文字に対する比率 */
export const RUBY_SCALE = 0.5
/** 文字サイズの上限と下限（mm）。下限でも収まらなければ末尾を省略する */
const MAX_FONT = 6
const MIN_FONT = 2
const FONT_STEP = 0.25
const ELLIPSIS = '…'

/** 列の中で親文字 start 字目から length 字に振るルビ */
interface ColumnRuby {
  start: number
  length: number
  text: string
}

interface VerticalColumn {
  text: string
  /** text の書記素の数 */
  length: number
  rubies: ColumnRuby[]
  /** 組みの右端から、この列の親文字の中心までの距離（mm） */
  offset: number
}

interface VerticalLayout {
  /** 右から順の列 */
  columns: VerticalColumn[]
  /** 組み全体の幅（mm） */
  width: number
  /** 文字サイズ（mm） */
  fontSize: number
  /** 収まらずに末尾を省略したか */
  truncated: boolean
}

/** 列の中で割らない一続き。ルビを振った語は語ごとにまとめる */
interface Unit {
  glyphs: string[]
  ruby?: string
}

let segmenter: Intl.Segmenter | undefined

function graphemes(text: string): string[] {
  if (!segmenter) segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

function toParagraphs(text: string): Unit[][] {
  return text
    .split('\n')
    .map((p) =>
      parseRuby(p).flatMap(({ base, ruby }) =>
        ruby === undefined
          ? graphemes(base).map((glyph) => ({ glyphs: [glyph] }))
          : [{ glyphs: graphemes(base), ruby }],
      ),
    )
}

const glyphCount = (units: readonly Unit[]) => units.reduce((n, u) => n + u.glyphs.length, 0)

function breakColumns(paragraphs: Unit[][], perColumn: number): Unit[][] {
  const columns: Unit[][] = []
  for (const units of paragraphs) {
    let column: Unit[] = []
    for (const unit of units) {
      if (column.length > 0 && glyphCount(column) + unit.glyphs.length > perColumn) {
        columns.push(column)
        column = []
      }
      column.push(unit)
    }
    columns.push(column)
  }
  return columns
}

/** ルビを振った語を割らないので、列が perColumn 字を超えうる。高さに収まるかを別に確かめる */
const fitsHeight = (columns: readonly Unit[][], fontSize: number, height: number) =>
  columns.every((c) => glyphCount(c) * fontSize <= height)

const columnWidth =(column: readonly Unit[], fontSize: number) =>
  column.some((u) => u.ruby) ? fontSize * (1 + RUBY_SCALE) : fontSize

function blockWidth(columns: readonly Unit[][], fontSize: number): number {
  if (columns.length === 0) return 0
  const widths = columns.reduce((sum, c) => sum + columnWidth(c, fontSize), 0)
  return widths + (columns.length - 1) * fontSize * (COLUMN_PITCH - 1)
}

function toLayout(columns: Unit[][], fontSize: number, truncated: boolean): VerticalLayout {
  let edge = 0
  const placed = columns.map((units) => {
    const width = columnWidth(units, fontSize)
    const offset = edge + width - fontSize / 2
    edge += width + fontSize * (COLUMN_PITCH - 1)
    const rubies: ColumnRuby[] = []
    let start = 0
    for (const u of units) {
      if (u.ruby) rubies.push({ start, length: u.glyphs.length, text: u.ruby })
      start += u.glyphs.length
    }
    return { text: units.flatMap((u) => u.glyphs).join(''), length: start, rubies, offset }
  })
  return { columns: placed, width: blockWidth(columns, fontSize), fontSize, truncated }
}

/**
 * セリフを w x h（mm）の箱に縦書きで割り付ける。`|単語《ルビ》` のルビは語ごと同じ列に置く。
 * 収まる最大の文字サイズを選び、MIN_FONT でも収まらなければ収まる列数で切り、最後の字を省略記号にする。
 * 禁則とルビによる親文字のあけは扱わない（レンダラと折り返し位置まで揃える必要はない）
 */
export function layoutVertical(text: string, box: { w: number; h: number }): VerticalLayout {
  const paragraphs = toParagraphs(text)
  if (paragraphs.every((p) => p.length === 0)) {
    return { columns: [], width: 0, fontSize: MIN_FONT, truncated: false }
  }
  const max = Math.min(MAX_FONT, box.w, box.h)
  for (let fontSize = max; fontSize >= MIN_FONT; fontSize -= FONT_STEP) {
    const columns = breakColumns(paragraphs, Math.floor(box.h / fontSize))
    if (fitsHeight(columns, fontSize, box.h) && blockWidth(columns, fontSize) <= box.w) {
      return toLayout(columns, fontSize, false)
    }
  }
  const fontSize = MIN_FONT
  const perColumn = Math.max(1, Math.floor(box.h / fontSize))
  const all = breakColumns(paragraphs, perColumn)
  let fit = 1
  while (fit < all.length && blockWidth(all.slice(0, fit + 1), fontSize) <= box.w) fit++
  if (all.length <= fit && fitsHeight(all, fontSize, box.h)) return toLayout(all, fontSize, false)
  const kept = all.slice(0, fit)
  const last = kept[kept.length - 1] ?? []
  const ellipsis = { glyphs: [ELLIPSIS] }
  kept[kept.length - 1] =
    glyphCount(last) >= perColumn ? [...last.slice(0, -1), ellipsis] : [...last, ellipsis]
  return toLayout(kept, fontSize, true)
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const texts = (layout: VerticalLayout) => layout.columns.map((c) => c.text)

  test('short text fits in one column at the largest size', () => {
    expect(layoutVertical('……芽が', { w: 10, h: 40 })).toEqual({
      columns: [{ text: '……芽が', length: 4, rubies: [], offset: 3 }],
      width: 6,
      fontSize: 6,
      truncated: false,
    })
  })

  test('long text wraps into columns from the right', () => {
    const layout = layoutVertical('あいうえおかきくけこ', { w: 12, h: 15 })
    expect(layout.truncated).toBe(false)
    expect(texts(layout).join('')).toBe('あいうえおかきくけこ')
    expect(layout.columns.length).toBeGreaterThan(1)
  })

  test('newlines start a new column', () => {
    expect(texts(layoutVertical('あ\nい', { w: 20, h: 20 }))).toEqual(['あ', 'い'])
  })

  test('overflow is cut and ends with an ellipsis', () => {
    const layout = layoutVertical('あ'.repeat(100), { w: 5, h: 10 })
    expect(layout.truncated).toBe(true)
    expect(layout.fontSize).toBe(MIN_FONT)
    expect(layout.columns).toHaveLength(2)
    expect(layout.columns.at(-1)?.text).toBe('ああああ…')
  })

  test('empty text has no columns', () => {
    expect(layoutVertical('', { w: 10, h: 10 }).columns).toEqual([])
  })

  test('ruby stays on the column of its base and widens that column', () => {
    const layout = layoutVertical('あ|魔法《まほう》\nい', { w: 30, h: 18 })
    expect(layout.fontSize).toBe(6)
    expect(layout.columns).toEqual([
      { text: 'あ魔法', length: 3, rubies: [{ start: 1, length: 2, text: 'まほう' }], offset: 6 },
      { text: 'い', length: 1, rubies: [], offset: 9 + 1.2 + 3 },
    ])
    expect(layout.width).toBeCloseTo(9 + 1.2 + 6)
  })

  test('a ruby word moves to the next column as a whole', () => {
    expect(texts(layoutVertical('あい|魔法《まほう》', { w: 30, h: 18 }))).toEqual(['あい', '魔法'])
  })
}
