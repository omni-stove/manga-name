/** 縦書きの行（1 列）の間隔。文字サイズに対する比率 */
export const COLUMN_PITCH = 1.2
/** 文字サイズの上限と下限（mm）。下限でも収まらなければ末尾を省略する */
const MAX_FONT = 6
const MIN_FONT = 2
const FONT_STEP = 0.25
const ELLIPSIS = '…'

interface VerticalLayout {
  /** 右から順の列。各要素は 1 列ぶんの文字列 */
  columns: string[]
  /** 文字サイズ（mm） */
  fontSize: number
  /** 収まらずに末尾を省略したか */
  truncated: boolean
}

let segmenter: Intl.Segmenter | undefined

function toParagraphs(text: string): string[][] {
  if (!segmenter) segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })
  const seg = segmenter
  return text.split('\n').map((p) => Array.from(seg.segment(p), (s) => s.segment))
}

function breakColumns(paragraphs: string[][], perColumn: number): string[][] {
  const columns: string[][] = []
  for (const glyphs of paragraphs) {
    if (glyphs.length === 0) columns.push([])
    for (let i = 0; i < glyphs.length; i += perColumn) {
      columns.push(glyphs.slice(i, i + perColumn))
    }
  }
  return columns
}

const blockWidth = (columns: number, fontSize: number) =>
  columns <= 0 ? 0 : (columns - 1) * fontSize * COLUMN_PITCH + fontSize

/**
 * セリフを w x h（mm）の箱に縦書きで割り付ける。収まる最大の文字サイズを選び、
 * MIN_FONT でも収まらなければ収まる列数で切り、最後の字を省略記号にする。
 * 禁則は扱わない（レンダラと折り返し位置まで揃える必要はない）
 */
export function layoutVertical(text: string, box: { w: number; h: number }): VerticalLayout {
  const paragraphs = toParagraphs(text)
  if (paragraphs.every((p) => p.length === 0)) {
    return { columns: [], fontSize: MIN_FONT, truncated: false }
  }
  const max = Math.min(MAX_FONT, box.w, box.h)
  for (let fontSize = max; fontSize >= MIN_FONT; fontSize -= FONT_STEP) {
    const columns = breakColumns(paragraphs, Math.floor(box.h / fontSize))
    if (blockWidth(columns.length, fontSize) <= box.w) {
      return { columns: columns.map((c) => c.join('')), fontSize, truncated: false }
    }
  }
  const fontSize = MIN_FONT
  const perColumn = Math.max(1, Math.floor(box.h / fontSize))
  const all = breakColumns(paragraphs, perColumn)
  const fit = Math.max(1, Math.floor((box.w - fontSize) / (fontSize * COLUMN_PITCH)) + 1)
  if (all.length <= fit) {
    return { columns: all.map((c) => c.join('')), fontSize, truncated: false }
  }
  const kept = all.slice(0, fit)
  const last = kept[kept.length - 1] ?? []
  kept[kept.length - 1] =
    last.length >= perColumn ? [...last.slice(0, -1), ELLIPSIS] : [...last, ELLIPSIS]
  return { columns: kept.map((c) => c.join('')), fontSize, truncated: true }
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('short text fits in one column at the largest size', () => {
    expect(layoutVertical('……芽が', { w: 10, h: 40 })).toEqual({
      columns: ['……芽が'],
      fontSize: 6,
      truncated: false,
    })
  })

  test('long text wraps into columns from the right', () => {
    const layout = layoutVertical('あいうえおかきくけこ', { w: 12, h: 15 })
    expect(layout.truncated).toBe(false)
    expect(layout.columns.join('')).toBe('あいうえおかきくけこ')
    expect(layout.columns.length).toBeGreaterThan(1)
  })

  test('newlines start a new column', () => {
    expect(layoutVertical('あ\nい', { w: 20, h: 20 }).columns).toEqual(['あ', 'い'])
  })

  test('overflow is cut and ends with an ellipsis', () => {
    const layout = layoutVertical('あ'.repeat(100), { w: 5, h: 10 })
    expect(layout.truncated).toBe(true)
    expect(layout.fontSize).toBe(MIN_FONT)
    expect(layout.columns).toHaveLength(2)
    expect(layout.columns.at(-1)).toBe('ああああ…')
  })

  test('empty text has no columns', () => {
    expect(layoutVertical('', { w: 10, h: 10 }).columns).toEqual([])
  })
}
