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

export type PageTemplate = 'blank' | '2rows' | '3rows' | '4rows'

const ROWS = { blank: 0, '2rows': 2, '3rows': 3, '4rows': 4 } as const
const COLUMNS = 2
const GUTTER = 0.02

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
 * direction は見ない。組み込みのテンプレートなら、createRowPanels で内枠を四方へ少し広げた範囲を同じ高さの行数ぶんの段に割り、
 * 各段を同じ幅の 2 列に割る。spread なら見開きのページを作り、見開きの内枠（SPREAD_INNER_FRAME）から割る。
 * 登録したコマ割りは 1 ページの紙面の座標なので、見開きには組み込みのテンプレートしか受けない
 */
export function createPage(template: PageTemplate, direction: ReadingDirection, spread: true): Page
export function createPage(
  template: PageTemplate | LayoutTemplate,
  direction: ReadingDirection,
): Page
export function createPage(
  template: PageTemplate | LayoutTemplate,
  direction: ReadingDirection,
  spread?: true,
): Page {
  if (typeof template === 'object') {
    const panels = template.panels.map(({ order, rect, shape }) => ({
      ...emptyPanel(order, { ...rect }),
      ...(shape && { shape: shape.map((p) => ({ ...p })) }),
    }))
    return { id: newId(), panels, scribbles: [] }
  }
  const rows = Array.from({ length: ROWS[template] }, () => ({
    height: 1,
    widths: Array.from({ length: COLUMNS }, () => 1),
  }))
  return {
    id: newId(),
    ...(spread && { spread }),
    panels: createRowPanels(rows, direction, { spread }),
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

/** ページに登場するキャラの id。ページの `cast`、各コマの panelCharacterIds の順に、重複なく集める */
export function pageCharacterIds(page: Page): ID[] {
  return [...new Set([...(page.cast ?? []), ...page.panels.flatMap(panelCharacterIds)])]
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest

  const overlap = (a: Panel['rect'], b: Panel['rect']) =>
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-9 &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-9

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

    for (const template of ['2rows', '3rows', '4rows'] as const) {
      for (const direction of ['rtl', 'ltr'] as const) {
        test(`${template} ${direction}: valid, no overlap, reading order`, () => {
          const page = createPage(template, direction)
          expect(PageSchema.safeParse(page).success).toBe(true)
          expect(page.panels).toHaveLength(ROWS[template] * COLUMNS)
          page.panels.forEach((a, i) => {
            for (const b of page.panels.slice(i + 1)) expect(overlap(a.rect, b.rect)).toBe(false)
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
          const right = Math.max(...page.panels.map((p) => p.rect.x + p.rect.w))
          const bottom = Math.max(...page.panels.map((p) => p.rect.y + p.rect.h))
          expect(Math.min(...page.panels.map((p) => p.rect.x))).toBeCloseTo(PANEL_AREA.x)
          expect(Math.min(...page.panels.map((p) => p.rect.y))).toBeCloseTo(PANEL_AREA.y)
          expect(right).toBeCloseTo(PANEL_AREA.x + PANEL_AREA.w)
          expect(bottom).toBeCloseTo(PANEL_AREA.y + PANEL_AREA.h)
          expect(PANEL_AREA.x).toBeLessThan(INNER_FRAME.x)
          expect(PANEL_AREA.x).toBeGreaterThan(0)
        })
      }
    }
  })

  test('a spread page splits the spread inner frame, which spans the gutter', () => {
    const page = createPage('2rows', 'rtl', true)
    expect(page.spread).toBe(true)
    expect(PageSchema.safeParse(page).success).toBe(true)
    const area = panelArea(SPREAD_INNER_FRAME)
    expect(Math.min(...page.panels.map((p) => p.rect.x))).toBeCloseTo(area.x)
    expect(Math.max(...page.panels.map((p) => p.rect.x + p.rect.w))).toBeCloseTo(area.x + area.w)
    // 見開きの外側の余白（mm）は 1 ページのときと同じ
    expect(SPREAD_INNER_FRAME.x * 2).toBeCloseTo(INNER_FRAME.x)
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
