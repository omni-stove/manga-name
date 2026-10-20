import {
  type Character,
  type CritiqueResponse,
  CritiqueResponseSchema,
  type ID,
  type JsonSchema,
  type LayoutSuggestionResponse,
  LayoutSuggestionResponseSchema,
  layoutSuggestionJsonSchema,
  type NameDraftResponse,
  NameDraftResponseSchema,
  type NamePanel,
  nameDraftJsonSchema,
  type Page,
  type PageDiagnosis,
  PagePlanReplySchema,
  type PagePlanResponse,
  type Panel,
  type Point,
  type ProjectSettings,
  pageCharacterIds,
  pagePlanJsonSchema,
  panelCharacterIds,
  StrengthSchema,
  VectorKindSchema,
} from '@manga/schema'
import type { z } from 'zod'
import { critiqueSystem } from './critique.prompt'
import {
  CAMERA_SHOTS,
  CHARACTER_ART_TAIL,
  NAME_NEGATIVE,
  NAME_STYLE,
  PAGE_ART_HEAD,
  PANEL_ART_TAIL,
  PLACEMENT_GUIDE,
} from './image.prompt'
import { suggestLayoutSystem } from './layout.prompt'
import { lineFields } from './lines.prompt'
import { transcribeNameSystem } from './name.prompt'
import { planPagesSystem } from './plan-pages.prompt'
import {
  type CharacterArtRequest,
  type CritiqueRequest,
  findPanel,
  type LayoutSuggestionRequest,
  type NameDraftRequest,
  type PageArtRequest,
  type PagePlanRequest,
  type PanelArtRequest,
} from './provider'

/** ページ割りで割り振らせるページ数の上限。Workers が受け付けるページ数の上限と揃える */
const MAX_PLANNED_PAGES = 64

/** コマ割りの提案で出させる案の数。LayoutSuggestionResponseSchema の上限と揃える */
const LAYOUT_OPTIONS = 3

/**
 * LLM に渡すプロンプト。schema は構造化出力に対応したプロバイダにそのまま渡し、
 * プロバイダは応答を output で検証してから返す
 */
export interface LlmPrompt<T> {
  system: string
  user: string
  schema: JsonSchema
  output: z.ZodType<T>
}

export type PanelArtPromptRequest = Omit<
  PanelArtRequest,
  'layoutPng' | 'referencePng' | 'characterRefs' | 'previous'
> & {
  /** 再生成時の修正指示 */
  instruction?: string
}

const hasPlacement = (panel: Panel) => panel.focusPoints.length > 0 || panel.vectors.length > 0

const formatPoint = (p: Point) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`

/** Vector の端点の呼び名。焦点かフキダシを指していればその名前、無ければ座標 */
function endpointLabel(panel: Panel, focusId: ID | undefined, pos: Point): string {
  if (focusId !== undefined) {
    const focus = panel.focusPoints.find((f) => f.id === focusId)
    if (focus) return `"${focus.label}"`
    const bubble = panel.bubbles.find((b) => b.id === focusId)
    if (bubble) return `speech bubble ${bubble.order}`
  }
  return formatPoint(pos)
}

/** コマに登場するキャラ。順は panelCharacterIds */
function panelCharacters(panel: Panel, characters: Character[]): Character[] {
  return panelCharacterIds(panel).flatMap((id) => characters.filter((c) => c.id === id))
}

const describeCharacter = (c: Character) => (c.appearance ? `${c.name}: ${c.appearance}` : c.name)

/** 全キャラに共通するデザインの行。キャラを描かせるプロンプトでだけ、キャラの行の前に入れる */
const characterDesign = (settings: ProjectSettings) =>
  settings.characterDesign &&
  `character design shared by every character: ${settings.characterDesign}`

/**
 * コマの中身を表す行。カメラ、指示メモ、登場キャラ、焦点（重い順）、誘導線、ヒント。空の行も含む。
 * `appearance` が false なら登場キャラは名前だけにする
 */
function panelContent(
  panel: Panel,
  characters: Character[],
  hint: string | undefined,
  appearance: boolean,
): (string | undefined)[] {
  const focusByWeight = [...panel.focusPoints].sort((a, b) => b.weight - a.weight)
  return [
    panel.camera && `camera: ${CAMERA_SHOTS[panel.camera]}`,
    panel.note,
    panelCharacters(panel, characters)
      .map((c) => (appearance ? describeCharacter(c) : c.name))
      .join('; '),
    focusByWeight.map((f) => f.label).join('; '),
    panel.vectors
      .map(
        (v) =>
          `${v.kind} from ${endpointLabel(panel, v.sourceFocusId, v.from)} to ${endpointLabel(panel, v.targetFocusId, v.to)}`,
      )
      .join('; '),
    hint,
  ]
}

const joinLines = (parts: (string | undefined)[]) =>
  parts.filter((p): p is string => Boolean(p)).join('\n')

/**
 * 画像生成プロンプト。parts の順に要素を改行で連結し、空の要素は飛ばす。
 * 焦点か誘導線のあるコマでは、末尾の前に配置の印の読み方を入れる。
 */
function panelArt(req: PanelArtPromptRequest): { prompt: string; negative: string } {
  const { characters, settings } = req.project
  const panel = findPanel(req.page, req.panelId)

  return {
    prompt: joinLines([
      NAME_STYLE,
      panelCharacters(panel, characters).length > 0 ? characterDesign(settings) : undefined,
      ...panelContent(panel, characters, req.hint, true),
      req.instruction && `revise the previous image: ${req.instruction}`,
      hasPlacement(panel) ? PLACEMENT_GUIDE : undefined,
      PANEL_ART_TAIL,
    ]),
    negative: NAME_NEGATIVE,
  }
}

export type PageArtPromptRequest = Omit<
  PageArtRequest,
  'layoutPng' | 'referencePng' | 'characterRefs'
>

const formatSpan = (from: number, size: number) => `${from.toFixed(2)}-${(from + size).toFixed(2)}`

/**
 * ページ全体の画像生成プロンプト。画風、配置図の説明、ページの登場キャラの外見、
 * コマごとの行（読み順の番号とページ内の範囲、その後に panelArt と同じ中身を名前だけのキャラで）、
 * 焦点か誘導線のあるコマがあれば配置の印の読み方、固定の末尾を改行で連結する。
 */
function pageArt(req: PageArtPromptRequest): { prompt: string; negative: string } {
  const { characters, settings } = req.project
  const cast = pageCharacterIds(req.page).flatMap((id) => characters.filter((c) => c.id === id))
  const panels = [...req.page.panels]
    .sort((a, b) => a.order - b.order)
    .map((panel) => {
      const { x, y, w, h } = panel.rect
      const content = panelContent(panel, characters, req.hints?.[panel.id], false)
        .filter((p): p is string => Boolean(p))
        .join('; ')
      const where = `panel ${panel.order} (x ${formatSpan(x, w)}, y ${formatSpan(y, h)})`
      return content ? `${where}: ${content}` : where
    })

  return {
    prompt: joinLines([
      NAME_STYLE,
      PAGE_ART_HEAD,
      cast.length > 0 ? characterDesign(settings) : undefined,
      cast.length > 0 ? `characters: ${cast.map(describeCharacter).join('; ')}` : undefined,
      ...panels,
      req.page.panels.some(hasPlacement) ? PLACEMENT_GUIDE : undefined,
      PANEL_ART_TAIL,
    ]),
    negative: NAME_NEGATIVE,
  }
}

/** キャラの参照画像のプロンプト。画風、共通のデザイン、名前と外見、固定の末尾を改行で連結する */
function characterArt(req: CharacterArtRequest): { prompt: string; negative: string } {
  return {
    prompt: joinLines([
      NAME_STYLE,
      characterDesign(req.project.settings),
      describeCharacter(req.character),
      CHARACTER_ART_TAIL,
    ]),
    negative: NAME_NEGATIVE,
  }
}

function characterList(characters: Character[]): string[] {
  return [
    'Characters:',
    ...(characters.length > 0
      ? characters.map((c) => `- id: ${c.id}, name: ${c.name}, shortName: ${c.shortName}`)
      : ['- (none)']),
  ]
}

/**
 * ページ割りのプロンプト。脚本をページに割り振り、ページごとの流れ、脚本の原文、登場キャラ、セリフの配列を返させる。
 * 応答は `pages` で包ませ、output が外して返す。
 * system に出力規則と JSON Schema、user にキャラ一覧、ページ数、脚本を入れる。
 */
function planPages(req: PagePlanRequest): LlmPrompt<PagePlanResponse> {
  const schema = pagePlanJsonSchema()

  const system = planPagesSystem(schema)

  const user = [
    ...characterList(req.project.characters),
    req.pageCount === undefined
      ? `Pages: as many as the script needs, at most ${MAX_PLANNED_PAGES}.`
      : `Pages: exactly ${req.pageCount}.`,
    'Script:',
    req.script,
  ].join('\n')

  return { system, user, schema, output: PagePlanReplySchema.transform(({ pages }) => pages) }
}

const POINT_JSON_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: { x: { type: 'number' }, y: { type: 'number' } },
}

/**
 * ネームの書き起こしのプロンプト。1 ページの脚本を、読む順のコマごとの描くもの、カメラ、セリフに割らせる。
 * system に出力規則と JSON Schema、user にキャラ一覧とページの脚本を入れる
 */
function transcribeName(req: NameDraftRequest): LlmPrompt<NameDraftResponse> {
  const schema = nameDraftJsonSchema()

  const system = transcribeNameSystem(schema)

  const user = [...characterList(req.project.characters), 'Script:', req.script].join('\n')

  return { system, user, schema, output: NameDraftResponseSchema }
}

/** ネームの 1 コマを、番号、描くもの、カメラ、セリフの行にする。話し手は枠の大きさに効かないので書かない */
function namePanelLines(panel: NamePanel, index: number): string[] {
  const camera = panel.camera === undefined ? '' : ` (${CAMERA_SHOTS[panel.camera]})`
  return [
    `${index + 1}. ${panel.note}${camera}`,
    ...(panel.lines.length > 0 ? panel.lines.map((l) => `   - ${l.text}`) : ['   - (no lines)']),
  ]
}

/**
 * コマ割りの提案のプロンプト。ネームのコマを段に割った案を LAYOUT_OPTIONS 個返させる。
 * system に出力規則と JSON Schema、user にコマの数と、読む順のコマごとの描くもの、カメラ、セリフを入れる
 */
function suggestLayout(req: LayoutSuggestionRequest): LlmPrompt<LayoutSuggestionResponse> {
  const schema = layoutSuggestionJsonSchema()

  const system = suggestLayoutSystem(LAYOUT_OPTIONS, schema)

  const user = [
    `Panels: exactly ${req.panels.length}, in reading order.`,
    ...req.panels.flatMap(namePanelLines),
  ].join('\n')

  return { system, user, schema, output: LayoutSuggestionResponseSchema }
}

/**
 * critique の応答の JSON Schema。CritiqueResponseSchema の patch は任意の操作を許すので、
 * 構造化出力では checkCritiquePatch が通す 2 種の操作だけを書ける形に絞る。
 * 範囲（0..1）とパスの形は構造化出力に頼らず、受け取った後に検査する
 */
function critiqueJsonSchema(): JsonSchema {
  const posOperation: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['op', 'path', 'value'],
    properties: {
      op: { type: 'string', enum: ['replace'] },
      path: {
        type: 'string',
        description: '/panels/<i>/focusPoints/<j>/pos or /panels/<i>/bubbles/<j>/pos',
      },
      value: POINT_JSON_SCHEMA,
    },
  }
  const vectorOperation: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['op', 'path', 'value'],
    properties: {
      op: { type: 'string', enum: ['add'] },
      path: { type: 'string', description: '/panels/<i>/vectors/-' },
      value: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'from', 'to', 'strength'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: [...VectorKindSchema.options] },
          from: POINT_JSON_SCHEMA,
          to: POINT_JSON_SCHEMA,
          strength: { type: 'string', enum: [...StrengthSchema.options] },
          sourceFocusId: { type: 'string' },
          targetFocusId: { type: 'string' },
        },
      },
    },
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'suggestions'],
    properties: {
      summary: { type: 'string' },
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['message', 'patch'],
          properties: {
            message: { type: 'string' },
            patch: { type: 'array', items: { anyOf: [posOperation, vectorOperation] } },
          },
        },
      },
    },
  }
}

/** critique で出す提案の上限。カードを 1 件ずつ見比べられる数に抑える */
const MAX_SUGGESTIONS = 5

/**
 * 診断の言語化と修正提案のプロンプト。system に出力規則と JSON Schema、
 * user にページの要素（配列の添字つき）、焦点ごとの診断、Issue の箇条書きを入れる。
 * Patch はページを根にしたパスで、焦点とフキダシの pos の replace とベクトルの add だけを許す
 */
function critique(req: CritiqueRequest): LlmPrompt<CritiqueResponse> {
  const { page, diagnosis } = req
  const schema = critiqueJsonSchema()

  const system = critiqueSystem(MAX_SUGGESTIONS, schema)

  const panels = page.panels.flatMap((panel, i) => [
    `[${i}] panel ${panel.id}, order ${panel.order}, rect x ${panel.rect.x.toFixed(2)} y ${panel.rect.y.toFixed(2)} w ${panel.rect.w.toFixed(2)} h ${panel.rect.h.toFixed(2)}${panel.camera ? `, camera ${panel.camera}` : ''}`,
    ...panel.focusPoints.map(
      (f, j) =>
        `  focusPoints[${j}] ${f.id}: ${f.kind} "${f.label}" at ${formatPoint(f.pos)}, weight ${f.weight.toFixed(2)}`,
    ),
    ...panel.bubbles.map(
      (b, j) =>
        `  bubbles[${j}] ${b.id}: order ${b.order}, ${b.shape} at ${formatPoint(b.pos)}, size ${b.size.w.toFixed(2)} x ${b.size.h.toFixed(2)}, text "${b.text.replaceAll('\n', ' ')}"`,
    ),
    ...panel.vectors.map(
      (v) =>
        `  vector ${v.id}: ${v.kind} ${v.strength} from ${endpointLabel(panel, v.sourceFocusId, v.from)} to ${endpointLabel(panel, v.targetFocusId, v.to)}`,
    ),
  ])

  const focus = diagnosis.panels.flatMap((d) =>
    d.focus.map(
      (f) =>
        `- ${f.focusPointId} (${f.kind}) in ${f.panelId}: ${f.status}, distance ${f.distance.toFixed(3)}, strong ${f.strong}, weak ${f.weak}${f.reason ? `, ${f.reason}` : ''}`,
    ),
  )

  const issues = diagnosis.issues.map((issue) => {
    const target = [issue.panelId, issue.focusPointId].filter(Boolean).join(' ')
    return `- [${issue.severity}] ${issue.code}${target ? ` (${target})` : ''}: ${issue.message}`
  })

  const { total, ok, weak, miss } = diagnosis.summary
  const user = [
    `Page ${page.id}, ${page.panels.length} panels.`,
    ...panels,
    'Diagnosis:',
    `Reading order ${diagnosis.readingOrderOk ? 'ok' : 'differs from the panel order'}: ${diagnosis.inferredOrder.join(' > ') || '(none)'}.`,
    `Focus points: ${total} total, ${ok} ok, ${weak} weak, ${miss} miss.`,
    ...focus,
    'Issues:',
    ...(issues.length > 0 ? issues : ['- (none)']),
  ].join('\n')

  return { system, user, schema, output: CritiqueResponseSchema }
}

export const prompts = {
  panelArt,
  pageArt,
  characterArt,
  planPages,
  transcribeName,
  suggestLayout,
  critique,
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')

  const project = fixtures.samplePage01

  test('panelArt joins the style, the panel content with appearances, and the tail', () => {
    const page = project.episodes[0]?.pages[0] as Page
    const { prompt, negative } = prompts.panelArt({
      project,
      page,
      panelId: 'pn_1',
      hint: 'ヒント',
      instruction: '明るく',
    })
    const lines = prompt.split('\n')
    expect(lines[0]).toBe(NAME_STYLE)
    expect(lines).toContain('camera: long shot')
    expect(lines).toContain('ヒント')
    expect(lines).toContain('revise the previous image: 明るく')
    expect(lines.at(-2)).toBe(PLACEMENT_GUIDE)
    expect(lines.at(-1)).toBe(PANEL_ART_TAIL)
    expect(negative).toBe(NAME_NEGATIVE)
  })

  test('pageArt lists the cast once and one line per panel in reading order with its span', () => {
    const page = project.episodes[0]?.pages[0] as Page
    const panel = page.panels.find((p) => p.order === 1) as Panel
    const { prompt, negative } = prompts.pageArt({
      project,
      page: { ...page, panels: [...page.panels].reverse() },
      hints: { [panel.id]: 'ヒント' },
    })
    const lines = prompt.split('\n')
    expect(lines.slice(0, 2)).toEqual([NAME_STYLE, PAGE_ART_HEAD])
    expect(lines.filter((l) => l.startsWith('characters: '))).toHaveLength(1)
    const panelLines = lines.filter((l) => l.startsWith('panel '))
    expect(panelLines.map((l) => Number(l.split(' ')[1]))).toEqual(
      page.panels.map((p) => p.order).sort((a, b) => a - b),
    )
    const { x, y, w, h } = panel.rect
    expect(panelLines[0]).toContain(
      `panel 1 (x ${x.toFixed(2)}-${(x + w).toFixed(2)}, y ${y.toFixed(2)}-${(y + h).toFixed(2)}): `,
    )
    expect(panelLines[0]?.endsWith('; ヒント')).toBe(true)
    expect(lines.at(-2)).toBe(PLACEMENT_GUIDE)
    expect(lines.at(-1)).toBe(PANEL_ART_TAIL)
    expect(negative).toBe(NAME_NEGATIVE)
  })

  test('pageArt leaves out the cast line and the colon for a bare page', () => {
    const bare: Page = {
      id: 'pg',
      scribbles: [],
      panels: [
        {
          id: 'pn',
          order: 1,
          rect: { x: 0, y: 0, w: 1, h: 1 },
          bubbles: [],
          focusPoints: [],
          vectors: [],
          arts: [],
        },
      ],
    }
    const { prompt } = prompts.pageArt({
      project: { settings: project.settings, characters: [] },
      page: bare,
    })
    expect(prompt.split('\n')).toEqual([
      NAME_STYLE,
      PAGE_ART_HEAD,
      'panel 1 (x 0.00-1.00, y 0.00-1.00)',
      PANEL_ART_TAIL,
    ])
  })

  test('characterArt joins the style, the name with the appearance, and the fixed tail', () => {
    const character = { id: 'c', name: 'エル', shortName: 'L', appearance: '銀髪、黒いコート' }
    const { prompt, negative } = prompts.characterArt({
      project: { settings: project.settings },
      character,
    })
    expect(prompt.split('\n')).toEqual([NAME_STYLE, 'エル: 銀髪、黒いコート', CHARACTER_ART_TAIL])
    expect(negative).toBe(NAME_NEGATIVE)
    const bare = prompts.characterArt({
      project: { settings: project.settings },
      character: { ...character, appearance: undefined },
    })
    expect(bare.prompt.split('\n')).toEqual([NAME_STYLE, 'エル', CHARACTER_ART_TAIL])
  })

  test('the shared character design goes before the characters only where characters are drawn', () => {
    const settings = { ...project.settings, characterDesign: '6 頭身、太い眉' }
    const design = 'character design shared by every character: 6 頭身、太い眉'
    const character = { id: 'c', name: 'エル', shortName: 'L' }
    expect(prompts.characterArt({ project: { settings }, character }).prompt.split('\n')).toEqual([
      NAME_STYLE,
      design,
      'エル',
      CHARACTER_ART_TAIL,
    ])

    const page = project.episodes[0]?.pages[0] as Page
    const panelLines = prompts
      .panelArt({ project: { ...project, settings }, page, panelId: 'pn_1' })
      .prompt.split('\n')
    expect(panelLines[1]).toBe(design)
    const pageLines = prompts
      .pageArt({ project: { ...project, settings }, page })
      .prompt.split('\n')
    expect(pageLines[2]).toBe(design)
    expect(pageLines[3]?.startsWith('characters: ')).toBe(true)

    const unpeopled = {
      ...page,
      panels: page.panels.map((p) => ({ ...p, bubbles: [], focusPoints: [], vectors: [] })),
    }
    expect(
      prompts.pageArt({ project: { ...project, settings }, page: unpeopled }).prompt,
    ).not.toContain(design)
    expect(
      prompts.panelArt({ project: { ...project, settings }, page: unpeopled, panelId: 'pn_1' })
        .prompt,
    ).not.toContain(design)
  })

  test('planPages embeds the page plan JSON Schema and lists characters, the page count and the script', () => {
    const { system, user, schema, output } = prompts.planPages({
      project: {
        settings: project.settings,
        characters: [{ id: 'chr_e', name: 'エリ', shortName: 'E' }],
      },
      script: 'E「こんにちは」\n森を歩く。',
      pageCount: 2,
    })
    expect(schema).toEqual(pagePlanJsonSchema())
    expect(system).toContain(`JSON Schema:\n${JSON.stringify(pagePlanJsonSchema())}`)
    const pages = [{ note: 'n', script: 's', cast: [], lines: [{ text: 't', shape: 'normal' }] }]
    expect(output.parse({ pages })).toEqual(pages)
    expect(user).toBe(
      [
        'Characters:',
        '- id: chr_e, name: エリ, shortName: E',
        'Pages: exactly 2.',
        'Script:',
        'E「こんにちは」',
        '森を歩く。',
      ].join('\n'),
    )
    expect(
      prompts.planPages({ project: { ...project, characters: [] }, script: 's' }).user,
    ).toContain(`- (none)\nPages: as many as the script needs, at most ${MAX_PLANNED_PAGES}.`)
  })

  test('transcribeName embeds the name JSON Schema and lists characters and the page script', () => {
    const { system, user, schema } = prompts.transcribeName({
      project: {
        settings: project.settings,
        characters: [{ id: 'chr_e', name: 'エリ', shortName: 'E' }],
      },
      script: 'E「こんにちは」\n森を歩く。',
    })
    expect(schema).toEqual(nameDraftJsonSchema())
    expect(system).toContain(`JSON Schema:\n${JSON.stringify(nameDraftJsonSchema())}`)
    expect(system).toContain(lineFields('in the panel').join('\n'))
    expect(user).toBe(
      [
        'Characters:',
        '- id: chr_e, name: エリ, shortName: E',
        'Script:',
        'E「こんにちは」',
        '森を歩く。',
      ].join('\n'),
    )
  })

  test('suggestLayout embeds the layout JSON Schema and lists the name panels in reading order', () => {
    const { system, user, schema } = prompts.suggestLayout({
      panels: [
        {
          note: '森の全景',
          camera: 'long',
          lines: [{ speakerId: 'chr_e', text: 'こんにちは', shape: 'normal' }],
        },
        { note: '足元', lines: [] },
      ],
    })
    expect(schema).toEqual(layoutSuggestionJsonSchema())
    expect(system).toContain(`JSON Schema:\n${JSON.stringify(layoutSuggestionJsonSchema())}`)
    expect(user).toBe(
      [
        'Panels: exactly 2, in reading order.',
        '1. 森の全景 (long shot)',
        '   - こんにちは',
        '2. 足元',
        '   - (no lines)',
      ].join('\n'),
    )
  })

  const page = project.episodes[0]?.pages[0] as Page
  const diagnosis: PageDiagnosis = {
    pageId: page.id,
    readingOrderOk: true,
    inferredOrder: page.panels.map((p) => p.id),
    panels: [
      {
        panelId: 'pn_4',
        sweepPath: [],
        focus: [
          {
            focusPointId: 'fp_4_e',
            kind: 'face',
            panelId: 'pn_4',
            t: 0.9,
            distance: 0.21,
            strong: 0,
            weak: 0,
            status: 'miss',
            reason: 'far from the sweep path',
          },
        ],
        bubbleOrderOk: true,
        hint: '',
      },
    ],
    bubbleChain: [],
    summary: { total: 1, ok: 0, weak: 0, miss: 1 },
    issues: [
      {
        severity: 'error',
        code: 'FOCUS_MISS',
        panelId: 'pn_4',
        focusPointId: 'fp_4_e',
        message: '焦点が視線経路から外れています',
      },
    ],
  }

  test('critique embeds its JSON Schema and limits the patch to pos and vectors', () => {
    const { system, schema } = prompts.critique({ page, diagnosis })
    expect(system).toContain(`JSON Schema:\n${JSON.stringify(schema)}`)
    expect(system).toContain(`at most ${MAX_SUGGESTIONS}`)
    const ops = JSON.stringify(schema)
    expect(ops).toContain('"enum":["replace"]')
    expect(ops).toContain('"enum":["add"]')
    expect(ops).not.toContain('"remove"')
  })

  test('critique lists the elements with array indexes, focus results and issues', () => {
    const { user } = prompts.critique({ page, diagnosis })
    expect(user).toContain('[3] panel pn_4, order 4')
    expect(user).toContain('  focusPoints[1] fp_4_e: face')
    expect(user).toContain('- fp_4_e (face) in pn_4: miss, distance 0.210')
    expect(user).toContain('- [error] FOCUS_MISS (pn_4 fp_4_e): 焦点が視線経路から外れています')
    expect(user).toContain('Focus points: 1 total, 0 ok, 0 weak, 1 miss.')
  })

  test('critique says so when there are no issues', () => {
    const { user } = prompts.critique({ page, diagnosis: { ...diagnosis, issues: [] } })
    expect(user).toMatch(/Issues:\n- \(none\)$/)
  })
}
