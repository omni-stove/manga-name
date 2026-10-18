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
 * direction は見ない。組み込みのテンプレートなら、内枠（INNER_FRAME）を行数ぶんの行に縦に割り、
 * 各行を 2 列に割る。コマはコマ間（GUTTER）を空けて重ならない。
 * order は行ごとに上から、行内は rtl なら右から、ltr なら左から振る。
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
    return { id: newId(), side: 'single', panels, scribbles: [] }
  }
  const rows = ROWS[template]
  const panels: Panel[] = []
  const h = (INNER_FRAME.h - GUTTER * (rows - 1)) / rows
  const w = (INNER_FRAME.w - GUTTER * (COLUMNS - 1)) / COLUMNS
  for (let row = 0; row < rows; row++) {
    for (let k = 0; k < COLUMNS; k++) {
      const col = direction === 'rtl' ? COLUMNS - 1 - k : k
      panels.push(
        emptyPanel(panels.length + 1, {
          x: INNER_FRAME.x + col * (w + GUTTER),
          y: INNER_FRAME.y + row * (h + GUTTER),
          w,
          h,
        }),
      )
    }
  }
  return { id: newId(), side: 'single', panels, scribbles: [] }
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
          expect(Math.min(...page.panels.map((p) => p.rect.x))).toBeCloseTo(INNER_FRAME.x)
          expect(Math.min(...page.panels.map((p) => p.rect.y))).toBeCloseTo(INNER_FRAME.y)
          expect(right).toBeCloseTo(INNER_FRAME.x + INNER_FRAME.w)
          expect(bottom).toBeCloseTo(INNER_FRAME.y + INNER_FRAME.h)
        })
      }
    }
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
