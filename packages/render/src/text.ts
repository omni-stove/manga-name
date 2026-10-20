import { type Bubble, parseRuby, type Size } from '@manga/schema'
import { typefaceFont } from './backend'
import type { PxRect } from './geometry'

/** 行（縦書きの 1 列、横書きの 1 行）の間隔。文字サイズに対する比率 */
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

/** 横書きで続けて書く間は割らない、英単語の字 */
const LATIN_WORD = /^[A-Za-z0-9'’.,!?;:-]$/

/** 横書きで実測できないときに半分の幅とみなす字。半角の英数字・記号と半角カナ */
const HALF_WIDTH = /^[\x20-\x7e｡-ﾟ]$/

const SPACE = /^\s$/u

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

/**
 * 行の中で割らない一続き。ルビの無い字は 1 字ずつ、ルビを振った語は語ごとにまとめる。
 * 横書きでは英単語も語ごとにまとめる
 */
export interface TextUnit {
  glyphs: string[]
  /** 親文字の右（横書きでは上）に振るルビの書記素 */
  ruby?: string[]
}

/** 1 字が行の向きに進む長さ（文字サイズ単位） */
export type Advance = (glyph: string) => number

/** 縦書きの送り。どの字も文字サイズ 1 つぶん */
const squareAdvance: Advance = () => 1

/** 横書きで書体を測れないときの送り。半角の字は文字サイズの半分 */
export const approximateAdvance: Advance = (glyph) => (HALF_WIDTH.test(glyph) ? 0.5 : 1)

/** 送りを測るときの文字サイズ。送りは文字サイズに比例するので、大きめの 1 つで測って割る */
const MEASURE_PX = 100

/** ctx に typeface を当てて測った横書きの送り。字ごとに 1 度だけ測る */
export function measuredAdvance(
  ctx: CanvasRenderingContext2D,
  typeface: NonNullable<Bubble['typeface']>,
): Advance {
  const cache = new Map<string, number>()
  return (glyph) => {
    let advance = cache.get(glyph)
    if (advance === undefined) {
      ctx.save()
      ctx.font = typefaceFont(typeface, MEASURE_PX)
      advance = ctx.measureText(glyph).width / MEASURE_PX
      ctx.restore()
      cache.set(glyph, advance)
    }
    return advance
  }
}

/** 英単語の字が続く所を 1 つの一続きにまとめる */
function joinWords(glyphs: string[]): TextUnit[] {
  const units: TextUnit[] = []
  for (const glyph of glyphs) {
    const last = units[units.length - 1]
    if (last && LATIN_WORD.test(glyph) && LATIN_WORD.test(lastGlyph(last))) {
      last.glyphs.push(glyph)
    } else {
      units.push({ glyphs: [glyph] })
    }
  }
  return units
}

/**
 * ルビの書式（parseRuby）を解き、段落ごとの TextUnit の列にする。ルビの書式は段落をまたがない。
 * horizontal なら英単語を途中で割らないようまとめる
 */
function toUnitParagraphs(text: string, horizontal: boolean): TextUnit[][] {
  return text
    .split('\n')
    .map((paragraph) =>
      parseRuby(paragraph).flatMap(({ base, ruby }) => {
        if (ruby !== undefined) return [{ glyphs: graphemes(base), ruby: graphemes(ruby) }]
        const glyphs = graphemes(base)
        return horizontal ? joinWords(glyphs) : glyphs.map((glyph) => ({ glyphs: [glyph] }))
      }),
    )
}

/** その字を縦書きで 90 度回転して置くか */
export function rotatesInVertical(glyph: string): boolean {
  return ROTATED.has(glyph) || SIDEWAYS.test(glyph)
}

const sumAdvance = (glyphs: string[], advance: Advance) =>
  glyphs.reduce((sum, glyph) => sum + advance(glyph), 0)

/** 親文字の長さ（文字サイズ単位） */
const baseLength = (unit: TextUnit, advance: Advance) => sumAdvance(unit.glyphs, advance)

/**
 * 一続きが行に占める長さ（文字サイズ単位）。ルビが親文字より長いときは、隣の字にかけず親文字の前後をあける。
 * かけないのは、隣の字が漢字かどうかで掛け方を変える処理を持たずに済ませるため
 */
function unitLength(unit: TextUnit, advance: Advance): number {
  return Math.max(
    baseLength(unit, advance),
    unit.ruby ? sumAdvance(unit.ruby, advance) * RUBY_SCALE : 0,
  )
}

const lineLength = (line: TextUnit[], advance: Advance) =>
  line.reduce((sum, unit) => sum + unitLength(unit, advance), 0)

const firstGlyph = (unit: TextUnit) => unit.glyphs[0] as string
const lastGlyph = (unit: TextUnit) => unit.glyphs[unit.glyphs.length - 1] as string

const isSpace = (unit: TextUnit | undefined) =>
  unit !== undefined && !unit.ruby && unit.glyphs.every((glyph) => SPACE.test(glyph))

/**
 * 文字サイズ単位で maxLength の長さごとに折り返す。禁則の字は前の行の末尾ごと次の行へ送る。
 * trimSpaces なら、折り返した所の空白を行末から除き、次の行頭にも置かない。英文の語の間の空白で行が中央からずれないように
 */
function breakLines(
  paragraphs: TextUnit[][],
  maxLength: number,
  advance: Advance,
  trimSpaces: boolean,
): TextUnit[][] {
  const lines: TextUnit[][] = []
  for (const units of paragraphs) {
    let line: TextUnit[] = []
    for (const unit of units) {
      if (line.length > 0 && lineLength(line, advance) + unitLength(unit, advance) > maxLength) {
        const carry: TextUnit[] = []
        if (NO_LINE_START.has(firstGlyph(unit)) && line.length > 1) {
          carry.unshift(line.pop() as TextUnit)
        }
        while (line.length > 1 && NO_LINE_END.has(lastGlyph(line[line.length - 1] as TextUnit))) {
          carry.unshift(line.pop() as TextUnit)
        }
        if (trimSpaces) {
          while (line.length > 1 && isSpace(line[line.length - 1])) line.pop()
        }
        lines.push(line)
        line = carry
        if (trimSpaces && line.length === 0 && isSpace(unit)) continue
      }
      line.push(unit)
    }
    lines.push(line)
  }
  return lines
}

/** 行の太さ（行を送る向きの幅）。ルビのある行は親文字の右（横書きでは上）にルビの幅を足す */
function lineThickness(line: TextUnit[], fontPx: number): number {
  return line.some((unit) => unit.ruby) ? fontPx * (1 + RUBY_SCALE) : fontPx
}

/** 行を送る向きの、組み全体の幅 */
function blockThickness(lines: TextUnit[][], fontPx: number): number {
  if (lines.length === 0) return 0
  const widths = lines.reduce((sum, line) => sum + lineThickness(line, fontPx), 0)
  return widths + (lines.length - 1) * fontPx * (COLUMN_PITCH - 1)
}

/**
 * セリフの行割り。`text` は `|単語《ルビ》` の書式でルビを振れる。`size` は px 単位の箱、`fontPx` は文字サイズの下限。
 * 箱に収まる整数 px の文字サイズのうち、最大のものか、それより少し小さくても行数が少なくなるものを選ぶ。
 * 下限でも収まらないときは下限のまま折り返して返す（はみ出す）。
 * `writing` が horizontal なら横書きで、字の幅を `advance` で測る。書き出しでは measuredAdvance を渡す。
 * `lines[i]` は縦書きでは右から、横書きでは上から i 番目の行の一続きの列。
 */
export function layoutBubbleText(
  text: string,
  size: Size,
  fontPx: number,
  writing?: Bubble['writing'],
  advance: Advance = approximateAdvance,
): { lines: TextUnit[][]; fontPx: number } {
  const horizontal = writing === 'horizontal'
  const step = horizontal ? advance : squareAdvance
  // 行の向きの長さと、行を送る向きの幅
  const along = horizontal ? size.w : size.h
  const across = horizontal ? size.h : size.w
  const paragraphs = toUnitParagraphs(text, horizontal)
  const min = Math.max(1, Math.floor(fontPx))
  const max = Math.floor(Math.min(size.h, size.w))
  const byLineCount = new Map<number, { lines: TextUnit[][]; fontPx: number }>()
  for (let px = max; px >= min; px--) {
    const lines = breakLines(paragraphs, along / px, step, horizontal)
    const longest = Math.max(0, ...lines.map((line) => lineLength(line, step)))
    const fits = blockThickness(lines, px) <= across && longest * px <= along
    if (fits && !byLineCount.has(lines.length)) {
      byLineCount.set(lines.length, { lines, fontPx: px })
    }
  }
  const largest = Math.max(0, ...Array.from(byLineCount.values(), (c) => c.fontPx))
  const chosen = Array.from(byLineCount.values())
    .filter((c) => c.fontPx >= largest * FEWER_LINES_TOLERANCE)
    .sort((a, b) => a.lines.length - b.lines.length)[0]
  if (chosen) return chosen
  return {
    lines: breakLines(paragraphs, Math.max(1, along / min), step, horizontal),
    fontPx: min,
  }
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

/**
 * 行割り済みの縦書きを、箱の中央に右の行から左へ color と typeface で描く。
 * ルビは親文字の右に、親文字の長さの中央に揃えて同じ書体で置く
 */
export function drawVerticalText(
  ctx: CanvasRenderingContext2D,
  lines: TextUnit[][],
  fontPx: number,
  box: PxRect,
  color = '#000',
  typeface: NonNullable<Bubble['typeface']> = 'gothic',
): void {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = color
  const font = (px: number) => typefaceFont(typeface, px)
  const rubyPx = fontPx * RUBY_SCALE
  let right = box.x + box.w / 2 + blockThickness(lines, fontPx) / 2
  for (const line of lines) {
    const width = lineThickness(line, fontPx)
    const cx = right - width + fontPx / 2
    let y = box.y + box.h / 2 - (lineLength(line, squareAdvance) * fontPx) / 2
    for (const unit of line) {
      const h = unitLength(unit, squareAdvance) * fontPx
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

/** 横書きの字を、左端 x から advance の幅で送りながら、em ボックスの上端を top に揃えて置く */
function drawRun(
  ctx: CanvasRenderingContext2D,
  glyphs: string[],
  x: number,
  top: number,
  fontPx: number,
  advance: Advance,
): void {
  let left = x
  for (const glyph of glyphs) {
    ctx.fillText(glyph, left, alphabeticY(top, fontPx, 'top'))
    left += advance(glyph) * fontPx
  }
}

/**
 * 行割り済みの横書きを、箱の中央に上の行から下へ color と typeface で描く。行は左右の中央に揃える。
 * ルビは親文字の上に、親文字の幅の中央に揃えて同じ書体で置く。advance は行割りに使ったものを渡す
 */
export function drawHorizontalText(
  ctx: CanvasRenderingContext2D,
  lines: TextUnit[][],
  fontPx: number,
  box: PxRect,
  color = '#000',
  typeface: NonNullable<Bubble['typeface']> = 'gothic',
  advance: Advance = approximateAdvance,
): void {
  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = color
  const font = (px: number) => typefaceFont(typeface, px)
  const rubyPx = fontPx * RUBY_SCALE
  let top = box.y + box.h / 2 - blockThickness(lines, fontPx) / 2
  for (const line of lines) {
    const height = lineThickness(line, fontPx)
    const baseTop = top + height - fontPx
    let x = box.x + box.w / 2 - (lineLength(line, advance) * fontPx) / 2
    for (const unit of line) {
      const w = unitLength(unit, advance) * fontPx
      ctx.font = font(fontPx)
      const baseX = x + (w - baseLength(unit, advance) * fontPx) / 2
      drawRun(ctx, unit.glyphs, baseX, baseTop, fontPx, advance)
      if (unit.ruby) {
        ctx.font = font(rubyPx)
        const rubyW = sumAdvance(unit.ruby, advance) * rubyPx
        drawRun(ctx, unit.ruby, x + (w - rubyW) / 2, baseTop - rubyPx, rubyPx, advance)
      }
      x += w
    }
    top += height + fontPx * (COLUMN_PITCH - 1)
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

  test('横書きは箱の幅で折り返し、縦書きと同じ禁則を守る', () => {
    const box = { w: 30, h: 34 }
    const { lines, fontPx } = layoutBubbleText('あいう。えお', box, 10, 'horizontal')
    expect(fontPx).toBe(10)
    expect(glyphs(lines)).toEqual([['あ', 'い'], ['う', '。', 'え'], ['お']])
  })

  test('横書きは英単語を割らず、折り返した所の空白を行の端に残さない', () => {
    // 半角は文字サイズの半分の幅とみなす。12px なら 1 行は 2.5 字ぶんで、Hello がちょうど収まる
    const box = { w: 30, h: 100 }
    const { lines, fontPx } = layoutBubbleText('Hello world', box, 10, 'horizontal')
    expect(fontPx).toBe(12)
    expect(glyphs(lines).map((line) => line.join(''))).toEqual(['Hello', 'world'])
  })

  test('横書きは渡した送りで字の幅を測る', () => {
    const narrow = () => 0.25
    const { lines } = layoutBubbleText('あいうえ', { w: 20, h: 100 }, 20, 'horizontal', narrow)
    expect(glyphs(lines)).toEqual([['あ', 'い', 'う', 'え']])
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

  test('ルビは親文字の右に半分の大きさで置く', () => {
    const fonts: string[] = []
    const placed: { text: string; x: number }[] = []
    const ctx = {
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      set font(value: string) {
        fonts.push(value)
      },
      fillText(text: string, x: number) {
        placed.push({ text, x })
      },
    } as unknown as CanvasRenderingContext2D
    const lines: TextUnit[][] = [[{ glyphs: ['魔'], ruby: ['ま'] }]]
    drawVerticalText(ctx, lines, 10, { x: 0, y: 0, w: 30, h: 30 })
    expect(placed.map((p) => p.text)).toEqual(['魔', 'ま'])
    expect(placed[1]?.x).toBeGreaterThan(placed[0]?.x ?? 0)
    expect(fonts.some((f) => f.startsWith('400 5px'))).toBe(true)
  })

  test('横書きのルビは親文字の上に、親文字の中央に揃えて半分の大きさで置く', () => {
    const fonts: string[] = []
    const placed: { text: string; x: number; y: number }[] = []
    const ctx = {
      save() {},
      restore() {},
      set font(value: string) {
        fonts.push(value)
      },
      fillText(text: string, x: number, y: number) {
        placed.push({ text, x, y })
      },
    } as unknown as CanvasRenderingContext2D
    const lines: TextUnit[][] = [[{ glyphs: ['魔'], ruby: ['ま'] }]]
    drawHorizontalText(ctx, lines, 10, { x: 0, y: 0, w: 30, h: 30 })
    const [base, ruby] = placed
    expect(placed.map((p) => p.text)).toEqual(['魔', 'ま'])
    expect(ruby?.y).toBeLessThan(base?.y ?? 0)
    // 左端で置くので、字の中心は左端に半字ぶん足した所
    expect((ruby?.x ?? 0) + 2.5).toBeCloseTo((base?.x ?? 0) + 5)
    expect((base?.x ?? 0) + 5).toBeCloseTo(15)
    expect(fonts.some((f) => f.startsWith('400 5px'))).toBe(true)
  })

  test('書体を渡すと、その字族と太さで描く', () => {
    const fonts: string[] = []
    const ctx = {
      save() {},
      restore() {},
      fillText() {},
      set font(value: string) {
        fonts.push(value)
      },
    } as unknown as CanvasRenderingContext2D
    drawVerticalText(
      ctx,
      [[{ glyphs: ['あ'] }]],
      10,
      { x: 0, y: 0, w: 30, h: 30 },
      '#000',
      'mincho',
    )
    drawVerticalText(ctx, [[{ glyphs: ['あ'] }]], 10, { x: 0, y: 0, w: 30, h: 30 }, '#000', 'bold')
    expect(fonts).toEqual(['400 10px "Noto Serif JP"', '700 10px "Noto Sans JP"'])
  })
}
