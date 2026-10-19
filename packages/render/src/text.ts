import { parseRuby, type Size } from '@manga/schema'
import { FONT_FAMILY } from './backend'
import type { PxRect } from './geometry'

/** 行（縦書きの 1 列）の間隔。文字サイズに対する比率 */
const COLUMN_PITCH = 1.2

/** ルビの文字サイズ。親文字に対する比率 */
const RUBY_SCALE = 0.5

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

function graphemes(text: string): string[] {
  if (!segmenter) segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

/** 書記素ごとに分ける。改行は段落の区切り */
function toParagraphs(text: string): string[][] {
  return text.split('\n').map(graphemes)
}

/** 行の中で割らない一続き。ルビの無い字は 1 字ずつ、ルビを振った語は語ごとにまとめる */
export interface TextUnit {
  glyphs: string[]
  /** 親文字の右に振るルビの書記素 */
  ruby?: string[]
}

/** ルビの書式（parseRuby）を解き、段落ごとの TextUnit の列にする。ルビの書式は段落をまたがない */
function toUnitParagraphs(text: string): TextUnit[][] {
  return text
    .split('\n')
    .map((paragraph) =>
      parseRuby(paragraph).flatMap(({ base, ruby }) =>
        ruby === undefined
          ? graphemes(base).map((glyph) => ({ glyphs: [glyph] }))
          : [{ glyphs: graphemes(base), ruby: graphemes(ruby) }],
      ),
    )
}

/** その字を縦書きで 90 度回転して置くか */
export function rotatesInVertical(glyph: string): boolean {
  return ROTATED.has(glyph) || SIDEWAYS.test(glyph)
}

/**
 * 一続きが行に占める長さ（文字サイズ単位）。ルビが親文字より長いときは、隣の字にかけず親文字の前後をあける。
 * かけないのは、隣の字が漢字かどうかで掛け方を変える処理を持たずに済ませるため
 */
function unitHeight(unit: TextUnit): number {
  return Math.max(unit.glyphs.length, (unit.ruby?.length ?? 0) * RUBY_SCALE)
}

const lineHeight = (line: TextUnit[]) => line.reduce((sum, unit) => sum + unitHeight(unit), 0)

const firstGlyph = (unit: TextUnit) => unit.glyphs[0] as string
const lastGlyph = (unit: TextUnit) => unit.glyphs[unit.glyphs.length - 1] as string

/** 文字サイズ単位で maxHeight の長さごとに折り返す。禁則の字は前の行の末尾ごと次の行へ送る */
function breakLines(paragraphs: TextUnit[][], maxHeight: number): TextUnit[][] {
  const lines: TextUnit[][] = []
  for (const units of paragraphs) {
    let line: TextUnit[] = []
    for (const unit of units) {
      if (line.length > 0 && lineHeight(line) + unitHeight(unit) > maxHeight) {
        const carry: TextUnit[] = []
        if (NO_LINE_START.has(firstGlyph(unit)) && line.length > 1) {
          carry.unshift(line.pop() as TextUnit)
        }
        while (line.length > 1 && NO_LINE_END.has(lastGlyph(line[line.length - 1] as TextUnit))) {
          carry.unshift(line.pop() as TextUnit)
        }
        lines.push(line)
        line = carry
      }
      line.push(unit)
    }
    lines.push(line)
  }
  return lines
}

/** 行の幅。ルビのある行は親文字の右にルビの幅を足す */
function lineWidth(line: TextUnit[], fontPx: number): number {
  return line.some((unit) => unit.ruby) ? fontPx * (1 + RUBY_SCALE) : fontPx
}

function blockWidth(lines: TextUnit[][], fontPx: number): number {
  if (lines.length === 0) return 0
  const widths = lines.reduce((sum, line) => sum + lineWidth(line, fontPx), 0)
  return widths + (lines.length - 1) * fontPx * (COLUMN_PITCH - 1)
}

function fits(lines: TextUnit[][], fontPx: number, size: Size): boolean {
  const tallest = Math.max(0, ...lines.map(lineHeight))
  return blockWidth(lines, fontPx) <= size.w && tallest * fontPx <= size.h
}

/**
 * 縦書きの行割り。`text` は `|単語《ルビ》` の書式でルビを振れる。`size` は px 単位の箱、`fontPx` は文字サイズの下限。
 * 箱に収まる整数 px の文字サイズのうち、最大のものか、それより少し小さくても行数が少なくなるものを選ぶ。
 * 下限でも収まらないときは下限のまま折り返して返す（はみ出す）。
 * `lines[i]` は右から i 番目の行の一続きの列。
 */
export function layoutBubbleText(
  text: string,
  size: Size,
  fontPx: number,
): { lines: TextUnit[][]; fontPx: number } {
  const paragraphs = toUnitParagraphs(text)
  const min = Math.max(1, Math.floor(fontPx))
  const max = Math.floor(Math.min(size.h, size.w))
  const byLineCount = new Map<number, { lines: TextUnit[][]; fontPx: number }>()
  for (let px = max; px >= min; px--) {
    const lines = breakLines(paragraphs, size.h / px)
    if (fits(lines, px, size) && !byLineCount.has(lines.length)) {
      byLineCount.set(lines.length, { lines, fontPx: px })
    }
  }
  const largest = Math.max(0, ...Array.from(byLineCount.values(), (c) => c.fontPx))
  const chosen = Array.from(byLineCount.values())
    .filter((c) => c.fontPx >= largest * FEWER_LINES_TOLERANCE)
    .sort((a, b) => a.lines.length - b.lines.length)[0]
  if (chosen) return chosen
  return { lines: breakLines(paragraphs, Math.max(1, size.h / min)), fontPx: min }
}

/** 縦書きの 1 字を、中心 (cx, cy) に現在の ctx.font の大きさ fontPx で置く */
function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: string,
  cx: number,
  cy: number,
  fontPx: number,
): void {
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
}

/** 行割り済みの縦書きを、箱の中央に右の行から左へ color で描く。ルビは親文字の右に、親文字の長さの中央に揃えて置く */
export function drawVerticalText(
  ctx: CanvasRenderingContext2D,
  lines: TextUnit[][],
  fontPx: number,
  box: PxRect,
  color = '#000',
): void {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = color
  const font = (px: number) => `${px}px "${FONT_FAMILY}"`
  const rubyPx = fontPx * RUBY_SCALE
  let right = box.x + box.w / 2 + blockWidth(lines, fontPx) / 2
  for (const line of lines) {
    const width = lineWidth(line, fontPx)
    const cx = right - width + fontPx / 2
    let y = box.y + box.h / 2 - (lineHeight(line) * fontPx) / 2
    for (const unit of line) {
      const h = unitHeight(unit) * fontPx
      const top = y + (h - unit.glyphs.length * fontPx) / 2
      ctx.font = font(fontPx)
      unit.glyphs.forEach((glyph, row) => {
        drawGlyph(ctx, glyph, cx, top + row * fontPx + fontPx / 2, fontPx)
      })
      if (unit.ruby) {
        const rubyTop = y + (h - unit.ruby.length * rubyPx) / 2
        ctx.font = font(rubyPx)
        unit.ruby.forEach((glyph, row) => {
          drawGlyph(
            ctx,
            glyph,
            cx + (fontPx + rubyPx) / 2,
            rubyTop + row * rubyPx + rubyPx / 2,
            rubyPx,
          )
        })
      }
      y += h
    }
    right -= width + fontPx * (COLUMN_PITCH - 1)
  }
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
  const glyphs = (lines: TextUnit[][]) => lines.map((line) => line.flatMap((u) => u.glyphs))

  test('20 文字は 2 行以上に割れ、字は失われない', () => {
    const text = 'ガラス結晶の森を歩くとー足跡に新芽が出た'
    expect(Array.from(text).length).toBe(20)
    const { lines, fontPx } = layoutBubbleText(text, { w: 120, h: 160 }, 8)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(glyphs(lines).flat().join('')).toBe(text)
    expect(fontPx).toBeGreaterThanOrEqual(8)
    expect(Math.max(...glyphs(lines).map((l) => l.length)) * fontPx).toBeLessThanOrEqual(160)
  })

  test('「……芽が」は 1 行に収まる', () => {
    const { lines } = layoutBubbleText('……芽が', { w: 60, h: 160 }, 8)
    expect(glyphs(lines)).toEqual([['…', '…', '芽', 'が']])
  })

  test('1px 大きくなるだけなら行数が少ない割り方を選ぶ', () => {
    // 2 行なら 24px、1 行なら 23px で収まる箱
    const { lines, fontPx } = layoutBubbleText('……？', { w: 54, h: 71 }, 8)
    expect(glyphs(lines)).toEqual([['…', '…', '？']])
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
    expect(glyphs(lines)).toEqual([['あ', 'い'], ['う', '。', 'え'], ['お']])
  })

  test('下限でも収まらないときは下限で折り返す', () => {
    const { fontPx, lines } = layoutBubbleText('あ'.repeat(50), { w: 10, h: 10 }, 8)
    expect(fontPx).toBe(8)
    expect(glyphs(lines).flat()).toHaveLength(50)
  })

  test('ルビを振った語は割らずに 1 つの一続きになり、書式の記号は描かない', () => {
    const { lines } = layoutBubbleText('あの|魔法陣《まほうじん》', { w: 20, h: 200 }, 8)
    expect(lines).toEqual([
      [
        { glyphs: ['あ'] },
        { glyphs: ['の'] },
        { glyphs: ['魔', '法', '陣'], ruby: ['ま', 'ほ', 'う', 'じ', 'ん'] },
      ],
    ])
  })

  test('ルビを振った語は行をまたがず、次の行へ送る', () => {
    const { lines } = layoutBubbleText('あい|魔法《まほう》', { w: 40, h: 30 }, 10)
    expect(glyphs(lines)).toEqual([
      ['あ', 'い'],
      ['魔', '法'],
    ])
  })

  test('親文字より長いルビは、その長さだけ行を使う', () => {
    // 1 字の親文字に 4 字のルビは 2 字ぶん。3 字ぶんの箱では「あ」と並ばない
    const { lines } = layoutBubbleText('あ|字《ながいよ》', { w: 40, h: 30 }, 10)
    expect(glyphs(lines)).toEqual([['あ'], ['字']])
  })

  test('ルビのある行はルビの幅だけ広く取る', () => {
    // ルビ無しなら 2 行で 22px、ルビがあると 10 + 5 + 2 + 10 = 27px で、8px に下がる
    expect(layoutBubbleText('あい\nうえ', { w: 22, h: 20 }, 1).fontPx).toBe(10)
    expect(layoutBubbleText('|あい《る》\nうえ', { w: 22, h: 20 }, 1).fontPx).toBe(8)
  })
}
