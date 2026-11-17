import { newId } from './id'
import {
  type Bubble,
  BubbleSchema,
  type ID,
  type LayoutTemplate,
  LayoutTemplateSchema,
  type Page,
  PageSchema,
  type Panel,
  type PanelActing,
  type PanelArt,
  type Project,
  ProjectSchema,
  type ReadingDirection,
  type Rect,
  SCHEMA_VERSION,
} from './project'

/** 既定設定の空プロジェクト（rtl、182x257mm、300dpi、エピソードなし） */
export function createEmptyProject(title: string): Project {
  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    settings: {
      direction: 'rtl',
      pageSize: { w: 182, h: 257, unit: 'mm' },
      dpi: 300,
    },
    characters: [],
    episodes: [],
  }
}

export type PageTemplate =
  | 'blank'
  | '1panel'
  | '2rows'
  | '3rows'
  | '4rows'
  | '3rows-split-middle'
  | '3rows-split-top'
  | 'diagonal'
  | 'inset'

const GUTTER = 0.02

const grid = (rows: number): RowLayout[] =>
  Array.from({ length: rows }, () => ({ height: 1, widths: [1, 1] }))

/** 段の比だけで割れる組み込みのテンプレート */
const ROW_TEMPLATES = {
  blank: [],
  '1panel': [{ height: 1, widths: [1] }],
  '2rows': grid(2),
  '3rows': grid(3),
  '4rows': grid(4),
  '3rows-split-middle': [
    { height: 1, widths: [1] },
    { height: 1, widths: [1, 1] },
    { height: 1, widths: [1] },
  ],
  '3rows-split-top': [
    { height: 1, widths: [1, 1, 1] },
    { height: 1, widths: [1] },
    { height: 1, widths: [1] },
  ],
} as const satisfies Record<Exclude<PageTemplate, 'diagonal' | 'inset'>, readonly RowLayout[]>

/** 'diagonal' の段。1 段目は割らず、2 段目と 3 段目を 2 つに割ってから割り線を傾ける */
const DIAGONAL_ROWS: readonly RowLayout[] = [{ height: 1, widths: [1] }, ...grid(2)]

/** 'diagonal' の割り線が段の上端と下端で段の中央から左右へずれる幅。段の幅に対する割合 */
const SLANT = 0.08

/** 'inset' の小さいコマの大きさ。コマを割る範囲に対する割合 */
const INSET = { w: 0.4, h: 0.26 } as const

/**
 * 内枠（基本枠）。ページ（仕上がり）に対する正規化座標で、中央に置く。B5 の投稿原稿の 182x257mm に対する
 * 150x220mm で、他の判型でも同じ比率にする
 */
export const INNER_FRAME = {
  x: (1 - 150 / 182) / 2,
  y: (1 - 220 / 257) / 2,
  w: 150 / 182,
  h: 220 / 257,
} as const

/**
 * 見開きの内枠。左右のページの内枠を、ノドの側の余白を除いて 1 つにつないだもの。見開きの紙面に対する正規化座標
 */
export const SPREAD_INNER_FRAME = {
  x: INNER_FRAME.x / 2,
  y: INNER_FRAME.y,
  w: 1 - INNER_FRAME.x,
  h: INNER_FRAME.h,
} as const

/** ページの内枠。見開きなら SPREAD_INNER_FRAME */
export function innerFrameOf(page: Pick<Page, 'spread'>): Rect {
  return page.spread ? SPREAD_INNER_FRAME : INNER_FRAME
}

/** 内枠から仕上がりまでの余白のうち、組み込みのテンプレートのコマを内枠の外へ出す割合 */
const OVERHANG = 1 / 3

/**
 * 組み込みのテンプレートがコマを割る範囲。コマの外周が内枠の線にそろうと作り物めいて見えるので、内枠を四方へ
 * 余白の OVERHANG だけ広げる
 */
function panelArea(frame: Rect): Rect {
  return {
    x: frame.x * (1 - OVERHANG),
    y: frame.y * (1 - OVERHANG),
    w: frame.w + 2 * frame.x * OVERHANG,
    h: frame.h + 2 * frame.y * OVERHANG,
  }
}

const PANEL_AREA = panelArea(INNER_FRAME)

const emptyPanel = (order: number, rect: Panel['rect']): Panel => ({
  id: newId(),
  order,
  rect,
  bubbles: [],
  arts: [],
  focusPoints: [],
  vectors: [],
})

/**
 * テンプレートからページを作る。登録したコマ割り（LayoutTemplate）なら、その枠と order のまま空のコマを置き、
 * direction は見ない。組み込みのテンプレートなら、内枠を四方へ少し広げた範囲に次のコマを置き、order は direction の
 * 読む順に振る。
 * - blank: コマなし
 * - 1panel: 範囲いっぱいの 1 コマ
 * - 2rows / 3rows / 4rows: 同じ高さの段に割り、各段を同じ幅の 2 列に割る
 * - 3rows-split-middle / 3rows-split-top: 同じ高さの 3 段に割り、中段を 2 つ、上段を 3 つに割る。他の段は割らない
 * - diagonal: 同じ高さの 3 段に割り、2 段目と 3 段目を互い違いに傾けた割り線で台形（shape）の 2 コマに割る
 * - inset: ページいっぱいの枠なしのコマを下敷きにし、読み始めの側の上の隅と読み終わりの側の下の隅に枠ありの
 *   小さいコマを重ねる。下敷き、上の小さいコマ、下の小さいコマの順に読む
 */
export function createPage(
  template: PageTemplate | LayoutTemplate,
  direction: ReadingDirection,
): Page {
  if (typeof template === 'object') {
    const panels = template.panels.map(({ order, rect, shape }) => ({
      ...emptyPanel(order, { ...rect }),
      ...(shape && { shape: shape.map((p) => ({ ...p })) }),
    }))
    return { id: newId(), panels, scribbles: [] }
  }
  return { id: newId(), panels: builtInPanels(template, direction), scribbles: [] }
}

function builtInPanels(template: PageTemplate, direction: ReadingDirection): Panel[] {
  switch (template) {
    case 'diagonal': {
      const [top, a, b, c, d] = createRowPanels(DIAGONAL_ROWS, direction)
      if (!top || !a || !b || !c || !d) throw new Error('DIAGONAL_ROWS must make 5 panels')
      // ltr は rtl の左右を反転したページにする
      const tilt = direction === 'rtl' ? SLANT : -SLANT
      return [top, ...slantRow(a, b, tilt), ...slantRow(c, d, -tilt)]
    }
    case 'inset':
      return insetPanels(direction)
    default:
      return createRowPanels(ROW_TEMPLATES[template], direction)
  }
}

/** 左右の x が上端で top、下端で bottom の台形の、囲む矩形と、その矩形に対する正規化座標の輪郭（左上から時計回り） */
function trapezoid(
  top: readonly [number, number],
  bottom: readonly [number, number],
  y: number,
  h: number,
): Pick<Panel, 'rect' | 'shape'> {
  const x = Math.min(top[0], bottom[0])
  const w = Math.max(top[1], bottom[1]) - x
  const u = (px: number) => (px - x) / w
  return {
    rect: { x, y, w, h },
    shape: [
      { x: u(top[0]), y: 0 },
      { x: u(top[1]), y: 0 },
      { x: u(bottom[1]), y: 1 },
      { x: u(bottom[0]), y: 1 },
    ],
  }
}

/**
 * 横に並んだ 2 つのコマを、割り線を傾けた 2 つの台形のコマにし直す。割り線は 2 つを合わせた段の中央を通り、
 * 上端で tilt × 段の幅だけ右へ、下端で同じだけ左へずれる。コマ間は横に GUTTER 空け、order はそのまま
 */
function slantRow(first: Panel, second: Panel, tilt: number): [Panel, Panel] {
  const left = Math.min(first.rect.x, second.rect.x)
  const right = Math.max(first.rect.x + first.rect.w, second.rect.x + second.rect.w)
  const { y, h } = first.rect
  const shift = tilt * (right - left)
  const top = (left + right) / 2 + shift
  const bottom = (left + right) / 2 - shift
  const half = GUTTER / 2
  const leftSide = trapezoid([left, top - half], [left, bottom - half], y, h)
  const rightSide = trapezoid([top + half, right], [bottom + half, right], y, h)
  const firstIsLeft = first.rect.x < second.rect.x
  return [
    { ...first, ...(firstIsLeft ? leftSide : rightSide) },
    { ...second, ...(firstIsLeft ? rightSide : leftSide) },
  ]
}

/**
 * 'inset' のコマ。下敷きを先に読む順にするのは、診断の読み順の推定が上端の順で、上端がページの上端の下敷きを
 * 先に読むとみなすため
 */
function insetPanels(direction: ReadingDirection): Panel[] {
  const area = PANEL_AREA
  const w = area.w * INSET.w
  const h = area.h * INSET.h
  const startX = direction === 'rtl' ? area.x + area.w - w : area.x
  const endX = direction === 'rtl' ? area.x : area.x + area.w - w
  return [
    { ...emptyPanel(1, { x: 0, y: 0, w: 1, h: 1 }), frame: 'none' },
    emptyPanel(2, { x: startX, y: area.y, w, h }),
    emptyPanel(3, { x: endX, y: area.y + area.h - h, w, h }),
  ]
}

/**
 * 見開きのページを作る。見開きの紙面いっぱいの枠なしのコマを 1 つだけ置き、枠ありのコマはその上に重ねて割らせる
 */
export function createSpreadPage(): Page {
  return {
    id: newId(),
    spread: true,
    panels: [{ ...emptyPanel(1, { x: 0, y: 0, w: 1, h: 1 }), frame: 'none' }],
    scribbles: [],
  }
}

/** 段の高さの比と、段の中のコマの幅の比（読む順） */
export interface RowLayout {
  height: number
  widths: readonly number[]
}

/**
 * 段の比から空のコマを作る。page の内枠（innerFrameOf）を四方へ少し広げた範囲を段の height の比で
 * 上から縦に割り、各段を widths の比で横に割る。
 * コマはコマ間（GUTTER）を空けて重ならない。order は段ごとに上から、段の中は widths の順に振り、
 * rtl なら右から、ltr なら左から並べる。比はどれも正の数
 */
export function createRowPanels(
  rows: readonly RowLayout[],
  direction: ReadingDirection,
  page: Pick<Page, 'spread'> = {},
): Panel[] {
  const area = panelArea(innerFrameOf(page))
  const totalHeight = rows.reduce((sum, row) => sum + row.height, 0)
  const freeHeight = area.h - GUTTER * (rows.length - 1)
  const panels: Panel[] = []
  let y = area.y
  for (const row of rows) {
    const h = (freeHeight * row.height) / totalHeight
    const totalWidth = row.widths.reduce((sum, w) => sum + w, 0)
    const freeWidth = area.w - GUTTER * (row.widths.length - 1)
    let offset = 0
    for (const width of row.widths) {
      const w = (freeWidth * width) / totalWidth
      const x = direction === 'rtl' ? area.x + area.w - offset - w : area.x + offset
      panels.push(emptyPanel(panels.length + 1, { x, y, w, h }))
      offset += w + GUTTER
    }
    y += h + GUTTER
  }
  return panels
}

/** page のコマの枠（order、rect、shape）を name のコマ割りにする。name は前後の空白を落とし、空なら throw */
export function createLayoutTemplate(page: Page, name: string): LayoutTemplate {
  return LayoutTemplateSchema.parse({
    id: newId(),
    name: name.trim(),
    panels: page.panels.map(({ order, rect, shape }) => ({ order, rect, ...(shape && { shape }) })),
  })
}

/** pos だけ必須。size 既定は 0.3x0.2、shape 既定は normal、order 既定は 1 */
export function createBubble(init: Partial<Bubble> & Pick<Bubble, 'pos'>): Bubble {
  return {
    id: newId(),
    order: 1,
    text: '',
    shape: 'normal',
    size: { w: 0.3, h: 0.2 },
    ...init,
  }
}

/** 採用中の PanelArt。artId が未設定、または arts に無ければ undefined */
export function currentArt(panel: Panel): PanelArt | undefined {
  if (panel.artId === undefined) return undefined
  return panel.arts.find((a) => a.id === panel.artId)
}

/**
 * コマに登場するキャラの id。`cast`、フキダシの `speakerId`、焦点の `characterId` の順に、重複なく集める。
 * 台詞も焦点も無いキャラは `cast` でしか拾えない
 */
export function panelCharacterIds(panel: Panel): ID[] {
  const ids = [
    ...(panel.cast ?? []),
    ...panel.bubbles.map((b) => b.speakerId),
    ...panel.focusPoints.map((f) => f.characterId),
  ].filter((id): id is ID => id !== undefined)
  return [...new Set(ids)]
}

/**
 * コマの芝居。panelCharacterIds の順に並べ、空白だけの芝居と登場キャラに居ないキャラの芝居は落とす。
 * フキダシの話者や焦点を外すと登場キャラから抜けても芝居は残るので、抜けたキャラの芝居を生成や指示メモに出さないため
 */
export function panelActing(panel: Panel): PanelActing[] {
  return panelCharacterIds(panel).flatMap((id) =>
    (panel.acting ?? []).filter((a) => a.characterId === id && a.text.trim() !== ''),
  )
}

/** ページに登場するキャラの id。ページの `cast`、各コマの panelCharacterIds の順に、重複なく集める */
export function pageCharacterIds(page: Page): ID[] {
  return [...new Set([...(page.cast ?? []), ...page.panels.flatMap(panelCharacterIds)])]
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { intersectPolygons, mayOverlap, panelOutline, polygonArea } = await import('./geometry')

  test('createEmptyProject uses default settings and is valid', () => {
    const p = createEmptyProject('t')
    expect(p.settings).toEqual({
      direction: 'rtl',
      pageSize: { w: 182, h: 257, unit: 'mm' },
      dpi: 300,
    })
    expect(ProjectSchema.safeParse(p).success).toBe(true)
  })

  test('createRowPanels splits the panel area by the ratios in reading order', () => {
    const rows = [
      { height: 2, widths: [1] },
      { height: 1, widths: [2, 1] },
    ]
    for (const direction of ['rtl', 'ltr'] as const) {
      const [wide, first, second] = createRowPanels(rows, direction)
      if (!wide || !first || !second) throw new Error('コマが 3 つない')
      expect([wide.order, first.order, second.order]).toEqual([1, 2, 3])
      expect(wide.rect.w).toBeCloseTo(PANEL_AREA.w)
      expect(wide.rect.h).toBeCloseTo(2 * first.rect.h)
      expect(first.rect.y).toBeCloseTo(wide.rect.y + wide.rect.h + GUTTER)
      expect(first.rect.w).toBeCloseTo(2 * second.rect.w)
      expect(first.rect.x > second.rect.x).toBe(direction === 'rtl')
      expect(first.rect.y + first.rect.h).toBeCloseTo(PANEL_AREA.y + PANEL_AREA.h)
    }
  })

  describe('createPage', () => {
    test('blank has no panels', () => {
      expect(createPage('blank', 'rtl').panels).toEqual([])
    })

    const counts = {
      '1panel': 1,
      '2rows': 4,
      '3rows': 6,
      '4rows': 8,
      '3rows-split-middle': 4,
      '3rows-split-top': 5,
      diagonal: 5,
      inset: 3,
    } as const
    for (const template of Object.keys(counts) as (keyof typeof counts)[]) {
      for (const direction of ['rtl', 'ltr'] as const) {
        test(`${template} ${direction}: valid, no overlap, reading order`, () => {
          const page = createPage(template, direction)
          expect(PageSchema.safeParse(page).success).toBe(true)
          expect(page.panels).toHaveLength(counts[template])
          page.panels.forEach((a, i) => {
            for (const b of page.panels.slice(i + 1)) {
              if (mayOverlap(a, b)) continue
              const common = intersectPolygons(panelOutline(a), panelOutline(b))
              expect(polygonArea(common)).toBeLessThan(1e-9)
            }
          })
          const ordered = [...page.panels].sort((a, b) => a.order - b.order)
          expect(ordered.map((p) => p.order)).toEqual(page.panels.map((_, i) => i + 1))
          ordered.forEach((p, i) => {
            const next = ordered[i + 1]
            if (!next) return
            if (Math.abs(p.rect.y - next.rect.y) < 1e-9) {
              expect(direction === 'rtl' ? p.rect.x > next.rect.x : p.rect.x < next.rect.x).toBe(
                true,
              )
            } else {
              expect(next.rect.y).toBeGreaterThan(p.rect.y)
            }
          })
          // 枠なしの下敷きは紙面いっぱいなので、範囲は枠ありのコマで見る
          const framed = page.panels.filter((p) => p.frame !== 'none')
          const right = Math.max(...framed.map((p) => p.rect.x + p.rect.w))
          const bottom = Math.max(...framed.map((p) => p.rect.y + p.rect.h))
          expect(Math.min(...framed.map((p) => p.rect.x))).toBeCloseTo(PANEL_AREA.x)
          expect(Math.min(...framed.map((p) => p.rect.y))).toBeCloseTo(PANEL_AREA.y)
          expect(right).toBeCloseTo(PANEL_AREA.x + PANEL_AREA.w)
          expect(bottom).toBeCloseTo(PANEL_AREA.y + PANEL_AREA.h)
          expect(PANEL_AREA.x).toBeLessThan(INNER_FRAME.x)
          expect(PANEL_AREA.x).toBeGreaterThan(0)
        })
      }

      test(`${template}: ltr mirrors rtl`, () => {
        const outlines = (direction: ReadingDirection) =>
          [...createPage(template, direction).panels]
            .sort((a, b) => a.order - b.order)
            .map((p) => panelOutline(p).map(({ x, y }) => ({ x: 1 - x, y })))
        const ltr = [...createPage(template, 'ltr').panels].sort((a, b) => a.order - b.order)
        outlines('rtl').forEach((mirrored, i) => {
          const panel = ltr[i]
          if (!panel) throw new Error(`ltr に ${i + 1} 番目のコマがない`)
          const outline = panelOutline(panel)
          for (const p of mirrored) {
            expect(outline.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)).toBe(true)
          }
        })
      })
    }

    test('diagonal cuts the 2nd and 3rd rows into trapezoids slanting opposite ways', () => {
      const page = createPage('diagonal', 'rtl')
      const [top, ...cut] = [...page.panels].sort((a, b) => a.order - b.order)
      expect(top?.shape).toBeUndefined()
      expect(cut.every((p) => p.shape?.length === 4)).toBe(true)
      // 割り線の上端の x − 下端の x。段の右のコマの左の辺で見る
      const lean = (p: Panel) => {
        const [topLeft, , , bottomLeft] = panelOutline(p)
        if (!topLeft || !bottomLeft) throw new Error('台形でない')
        return topLeft.x - bottomLeft.x
      }
      const [second, , fourth] = cut
      if (!second || !fourth) throw new Error('斜めのコマが無い')
      expect(lean(second)).toBeGreaterThan(0)
      expect(lean(fourth)).toBeLessThan(0)
    })

    test('inset lays two framed panels over a borderless panel covering the page', () => {
      const page = createPage('inset', 'rtl')
      const [base, first, last] = [...page.panels].sort((a, b) => a.order - b.order)
      if (!base || !first || !last) throw new Error('inset のコマが 3 つない')
      expect(base).toMatchObject({ frame: 'none', rect: { x: 0, y: 0, w: 1, h: 1 } })
      expect(first.frame).toBeUndefined()
      expect(last.frame).toBeUndefined()
      // rtl は右上から読み始め、左下で読み終わる
      expect(first.rect.x + first.rect.w).toBeCloseTo(PANEL_AREA.x + PANEL_AREA.w)
      expect(first.rect.y).toBeCloseTo(PANEL_AREA.y)
      expect(last.rect.x).toBeCloseTo(PANEL_AREA.x)
      expect(last.rect.y + last.rect.h).toBeCloseTo(PANEL_AREA.y + PANEL_AREA.h)
    })
  })

  test('a spread is split from the spread inner frame, which spans the gutter', () => {
    const panels = createRowPanels([{ height: 1, widths: [1, 1] }], 'rtl', { spread: true })
    const area = panelArea(SPREAD_INNER_FRAME)
    expect(Math.min(...panels.map((p) => p.rect.x))).toBeCloseTo(area.x)
    expect(Math.max(...panels.map((p) => p.rect.x + p.rect.w))).toBeCloseTo(area.x + area.w)
    // 見開きの外側の余白（mm）は 1 ページのときと同じ
    expect(SPREAD_INNER_FRAME.x * 2).toBeCloseTo(INNER_FRAME.x)
  })

  test('a spread page starts with one borderless panel over the whole spread', () => {
    const page = createSpreadPage()
    expect(page.spread).toBe(true)
    expect(PageSchema.safeParse(page).success).toBe(true)
    expect(page.panels).toHaveLength(1)
    expect(page.panels[0]).toMatchObject({
      order: 1,
      frame: 'none',
      rect: { x: 0, y: 0, w: 1, h: 1 },
    })
    expect(createPage('2rows', 'rtl').spread).toBeUndefined()
  })

  test('createLayoutTemplate keeps only the panel frames, and createPage restores them', () => {
    const page = createPage('3rows', 'rtl')
    const [first] = page.panels
    if (!first) throw new Error('3rows のページにコマがない')
    first.shape = [
      { x: first.rect.x, y: first.rect.y },
      { x: first.rect.x + first.rect.w, y: first.rect.y },
      { x: first.rect.x, y: first.rect.y + first.rect.h },
    ]
    first.note = 'n'
    first.bubbles.push(createBubble({ pos: { x: 0.5, y: 0.5 } }))
    const template = createLayoutTemplate(page, '  決め 3 段 ')
    expect(template.name).toBe('決め 3 段')
    expect(template.panels[0]).toEqual({ order: 1, rect: first.rect, shape: first.shape })
    expect(template.panels[1]).not.toHaveProperty('shape')

    const restored = createPage(template, 'ltr')
    expect(PageSchema.safeParse(restored).success).toBe(true)
    expect(restored.panels.map(({ order, rect, shape }) => ({ order, rect, shape }))).toEqual(
      page.panels.map(({ order, rect, shape }) => ({ order, rect, shape })),
    )
    expect(restored.panels[0]).toMatchObject({ bubbles: [], arts: [] })
    expect(restored.panels[0]?.id).not.toBe(first.id)
    expect(() => createLayoutTemplate(page, ' ')).toThrow()
  })

  test('createBubble applies defaults and overrides', () => {
    const b = createBubble({ pos: { x: 0.5, y: 0.5 } })
    expect(b).toMatchObject({ shape: 'normal', size: { w: 0.3, h: 0.2 }, text: '' })
    expect(BubbleSchema.safeParse(b).success).toBe(true)
    expect(createBubble({ pos: { x: 0, y: 0 }, shape: 'shout', text: 'a' })).toMatchObject({
      shape: 'shout',
      text: 'a',
    })
  })

  test('currentArt returns the adopted art or undefined', () => {
    const panel = emptyPanel(1, { x: 0, y: 0, w: 1, h: 1 })
    expect(currentArt(panel)).toBeUndefined()
    const art: PanelArt = {
      id: 'a1',
      ref: 'blob:1',
      provider: 'fake',
      prompt: 'p',
      createdAt: '2026-10-15T00:00:00.000Z',
    }
    panel.arts.push(art)
    expect(currentArt(panel)).toBeUndefined()
    panel.artId = 'a1'
    expect(currentArt(panel)).toBe(art)
  })

  test('panelCharacterIds lists cast, speakers and focus characters once, in that order', () => {
    const panel = emptyPanel(1, { x: 0, y: 0, w: 1, h: 1 })
    expect(panelCharacterIds(panel)).toEqual([])
    panel.bubbles.push(
      createBubble({ pos: { x: 0, y: 0 }, speakerId: 'b' }),
      createBubble({ pos: { x: 0, y: 0 } }),
    )
    panel.focusPoints.push({
      id: 'f',
      kind: 'face',
      label: 'a',
      pos: { x: 0, y: 0 },
      weight: 1,
      characterId: 'a',
    })
    panel.cast = ['c', 'a']
    expect(panelCharacterIds(panel)).toEqual(['c', 'a', 'b'])
  })

  test('panelActing follows panelCharacterIds and drops blank acting and characters not in the panel', () => {
    const panel = emptyPanel(1, { x: 0, y: 0, w: 1, h: 1 })
    expect(panelActing(panel)).toEqual([])
    panel.bubbles.push(createBubble({ pos: { x: 0, y: 0 }, speakerId: 'b' }))
    panel.cast = ['a', 'c']
    panel.acting = [
      { characterId: 'b', text: '叫ぶ' },
      { characterId: 'x', text: '去る' },
      { characterId: 'c', text: ' ' },
      { characterId: 'a', text: '振り向いて驚く' },
    ]
    expect(panelActing(panel)).toEqual([
      { characterId: 'a', text: '振り向いて驚く' },
      { characterId: 'b', text: '叫ぶ' },
    ])
  })

  test('pageCharacterIds lists the page cast, then the characters of each panel, once', () => {
    const page = createPage('2rows', 'rtl')
    expect(pageCharacterIds(page)).toEqual([])
    const [first, second] = page.panels
    if (!first || !second) throw new Error('2rows のページにコマが 2 つない')
    first.cast = ['a', 'b']
    second.cast = ['c']
    page.cast = ['c', 'd']
    expect(pageCharacterIds(page)).toEqual(['c', 'd', 'a', 'b'])
  })
}
