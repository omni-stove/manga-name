import type { Size } from '@manga/schema'
import { FONT_FAMILY } from './backend'
import type { PxRect } from './geometry'

/** 行（縦書きの 1 列）の間隔。文字サイズに対する比率 */
const COLUMN_PITCH = 1.2

/** 行数が少ない割り方を、最大の文字サイズに対してこの比率まで小さくなっても優先する */
const FEWER_LINES_TOLERANCE = 0.8

/** 縦書きで 90 度回転して置く字。長音、ダッシュ、三点リーダ、括弧 */
const ROTATED = new Set('ー〜～…‥—―－()（）[]［］{}｛｝「」『』【】〈〉《》〔〕')

/** 縦書きで 90 度回転して置く半角英数字。エディタの SVG（text-orientation: mixed）と向きを揃える */
const SIDEWAYS = /^[A-Za-z0-9]$/

/** 行頭に置かない字。前の行の末尾の字を道連れに次の行へ送る */
const NO_LINE_START = new Set(
  '、。，．・）」』】〉》〕］｝!?！？ーゝゞヽヾ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ',
)

/** 行末に置かない字 */
const NO_LINE_END = new Set('（「『【〈《〔［｛')

// 同梱の Noto Sans JP の em ボックス。OS/2 の sTypoAscender 880、sTypoDescender -120（unitsPerEm 1000）
const EM_ASCENT = 0.88
const EM_DESCENT = 0.12

/**
 * textBaseline の 'top'（em ボックスの上端）か 'middle'（em ボックスの中央）に字を置くつもりの y を、
 * textBaseline = 'alphabetic' で fillText するときの y に直す。
 * Canvas の 'top' / 'middle' を使わないのは、@napi-rs/canvas が em ボックスでなく hhea の ascent / descent から
 * 位置を決め、ブラウザより字が fontPx の 5〜10% 下にずれて、スナップショットが書き出しと食い違うため
 */
export function alphabeticY(y: number, fontPx: number, baseline: 'top' | 'middle'): number {
  return baseline === 'top' ? y + EM_ASCENT * fontPx : y + ((EM_ASCENT - EM_DESCENT) / 2) * fontPx
}

let segmenter: Intl.Segmenter | undefined

/** 書記素ごとに分ける。改行は段落の区切り */
function toParagraphs(text: string): string[][] {
  if (!segmenter) segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })
  const seg = segmenter
  return text.split('\n').map((paragraph) => Array.from(seg.segment(paragraph), (s) => s.segment))
}

/** その字を縦書きで 90 度回転して置くか */
export function rotatesInVertical(glyph: string): boolean {
  return ROTATED.has(glyph) || SIDEWAYS.test(glyph)
}

/** perColumn 字ごとに折り返す。禁則の字は前の行の末尾ごと次の行へ送る */
function breakLines(paragraphs: string[][], perColumn: number): string[][] {
  const lines: string[][] = []
  for (const glyphs of paragraphs) {
    let line: string[] = []
    for (const glyph of glyphs) {
      if (line.length >= perColumn) {
        const carry: string[] = []
        if (NO_LINE_START.has(glyph) && line.length > 1) carry.unshift(line.pop() as string)
        while (line.length > 1 && NO_LINE_END.has(line[line.length - 1] as string)) {
          carry.unshift(line.pop() as string)
        }
        lines.push(line)
        line = carry
      }
      line.push(glyph)
    }
    lines.push(line)
  }
  return lines
}

function blockWidth(columns: number, fontPx: number): number {
  return columns <= 0 ? 0 : (columns - 1) * fontPx * COLUMN_PITCH + fontPx
}

function fits(lines: string[][], fontPx: number, size: Size): boolean {
  const tallest = Math.max(0, ...lines.map((line) => line.length))
  return blockWidth(lines.length, fontPx) <= size.w && tallest * fontPx <= size.h
}

/**
 * 縦書きの行割り。`size` は px 単位の箱、`fontPx` は文字サイズの下限。
 * 箱に収まる整数 px の文字サイズのうち、最大のものか、それより少し小さくても行数が少なくなるものを選ぶ。
 * 下限でも収まらないときは下限のまま折り返して返す（はみ出す）。
 * `lines[i]` は右から i 番目の行の書記素の列。
 */
export function layoutBubbleText(
  text: string,
  size: Size,
  fontPx: number,
): { lines: string[][]; fontPx: number } {
  const paragraphs = toParagraphs(text)
  const min = Math.max(1, Math.floor(fontPx))
  const max = Math.floor(Math.min(size.h, size.w))
  const byLineCount = new Map<number, { lines: string[][]; fontPx: number }>()
  for (let px = max; px >= min; px--) {
    const lines = breakLines(paragraphs, Math.floor(size.h / px))
    if (fits(lines, px, size) && !byLineCount.has(lines.length)) {
      byLineCount.set(lines.length, { lines, fontPx: px })
    }
  }
  const largest = Math.max(0, ...Array.from(byLineCount.values(), (c) => c.fontPx))
  const chosen = Array.from(byLineCount.values())
    .filter((c) => c.fontPx >= largest * FEWER_LINES_TOLERANCE)
    .sort((a, b) => a.lines.length - b.lines.length)[0]
  if (chosen) return chosen
  return { lines: breakLines(paragraphs, Math.max(1, Math.floor(size.h / min))), fontPx: min }
}

/** 行割り済みの縦書きを、箱の中央に右の行から左へ描く */
export function drawVerticalText(
  ctx: CanvasRenderingContext2D,
  lines: string[][],
  fontPx: number,
  box: PxRect,
): void {
  ctx.save()
  ctx.font = `${fontPx}px "${FONT_FAMILY}"`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#000'
  const pitch = fontPx * COLUMN_PITCH
  const right = box.x + box.w / 2 + blockWidth(lines.length, fontPx) / 2
  lines.forEach((line, column) => {
    const cx = right - fontPx / 2 - column * pitch
    const top = box.y + box.h / 2 - (line.length * fontPx) / 2
    line.forEach((glyph, row) => {
      const cy = top + row * fontPx + fontPx / 2
      if (SIDEWAYS.test(glyph)) {
        // 英数字は字面の中心で回すと g や y が持ち上がって並びが揃わないので、ベースラインを保って回す
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(Math.PI / 2)
        ctx.fillText(glyph, 0, alphabeticY(0, fontPx, 'middle'))
        ctx.restore()
      } else if (rotatesInVertical(glyph)) {
        // 三点リーダや長音は仮想ボディの中で下や端に寄っているので、字面の中心を軸に回す
        const m = ctx.measureText(glyph)
        const dx = (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2
        const dy = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(Math.PI / 2)
        ctx.fillText(glyph, dx, dy)
        ctx.restore()
      } else {
        ctx.fillText(glyph, cx, alphabeticY(cy, fontPx, 'middle'))
      }
    })
  })
  ctx.restore()
}

/** 横書きを書記素単位で maxWidth に折り返す。改行は段落の区切り */
export function wrapHorizontal(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = []
  for (const glyphs of toParagraphs(text)) {
    let line = ''
    for (const glyph of glyphs) {
      const next = line + glyph
      if (line !== '' && ctx.measureText(next).width > maxWidth) {
        lines.push(line)
        line = glyph
      } else {
        line = next
      }
    }
    lines.push(line)
  }
  return lines
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('20 文字は 2 行以上に割れ、字は失われない', () => {
    const text = 'ガラス結晶の森を歩くとー足跡に新芽が出た'
    expect(Array.from(text).length).toBe(20)
    const { lines, fontPx } = layoutBubbleText(text, { w: 120, h: 160 }, 8)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.flat().join('')).toBe(text)
    expect(fontPx).toBeGreaterThanOrEqual(8)
    expect(Math.max(...lines.map((l) => l.length)) * fontPx).toBeLessThanOrEqual(160)
  })

  test('「……芽が」は 1 行に収まる', () => {
    const { lines } = layoutBubbleText('……芽が', { w: 60, h: 160 }, 8)
    expect(lines).toEqual([['…', '…', '芽', 'が']])
  })

  test('1px 大きくなるだけなら行数が少ない割り方を選ぶ', () => {
    // 2 行なら 24px、1 行なら 23px で収まる箱
    const { lines, fontPx } = layoutBubbleText('……？', { w: 54, h: 71 }, 8)
    expect(lines).toEqual([['…', '…', '？']])
    expect(fontPx).toBe(23)
  })

  test('長音と括弧と半角英数字は回転し、仮名と漢字は回転しない', () => {
    expect(rotatesInVertical('ー')).toBe(true)
    expect(rotatesInVertical('「')).toBe(true)
    expect(rotatesInVertical('A')).toBe(true)
    expect(rotatesInVertical('z')).toBe(true)
    expect(rotatesInVertical('7')).toBe(true)
    expect(rotatesInVertical('あ')).toBe(false)
    expect(rotatesInVertical('芽')).toBe(false)
  })

  test('句読点は行頭に来ない', () => {
    const { lines, fontPx } = layoutBubbleText('あいう。えお', { w: 34, h: 30 }, 10)
    expect(fontPx).toBe(10)
    expect(lines).toEqual([['あ', 'い'], ['う', '。', 'え'], ['お']])
  })

  test('下限でも収まらないときは下限で折り返す', () => {
    const { fontPx, lines } = layoutBubbleText('あ'.repeat(50), { w: 10, h: 10 }, 8)
    expect(fontPx).toBe(8)
    expect(lines.flat()).toHaveLength(50)
  })
}
