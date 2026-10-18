import {
  type Character,
  type ID,
  type JsonSchema,
  type Page,
  type PageDiagnosis,
  type Panel,
  type Point,
  pageCharacterIds,
  pagePlanJsonSchema,
  panelCharacterIds,
  StrengthSchema,
  VectorKindSchema,
} from '@manga/schema'
import {
  type CharacterArtRequest,
  type CritiqueRequest,
  findPanel,
  type PageArtRequest,
  type PagePlanRequest,
  type PanelArtRequest,
} from './provider'

/** ページ割りで割り振らせるページ数の上限。Workers が受け付けるページ数の上限と揃える */
const MAX_PLANNED_PAGES = 64

/** LLM に渡すプロンプト。schema は構造化出力に対応したプロバイダにそのまま渡す */
export interface LlmPrompt {
  system: string
  user: string
  schema: JsonSchema
}

export type PanelArtPromptRequest = Omit<
  PanelArtRequest,
  'layoutPng' | 'referencePng' | 'characterRefs' | 'previous'
> & {
  /** 再生成時の修正指示 */
  instruction?: string
}

/** 画像生成の固定の末尾。配置図の白い領域（フキダシ）を空けさせる */
const PANEL_ART_TAIL =
  'no text, no letters, no speech bubbles, leave the white areas of the layout image empty'

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
    panel.camera && `camera: ${panel.camera}`,
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
 * negative は settings.style.negative（無ければ空文字）。
 */
function panelArt(req: PanelArtPromptRequest): { prompt: string; negative: string } {
  const { settings, characters } = req.project
  const panel = findPanel(req.page, req.panelId)

  return {
    prompt: joinLines([
      settings.style.prompt,
      ...panelContent(panel, characters, req.hint, true),
      req.instruction && `revise the previous image: ${req.instruction}`,
      PANEL_ART_TAIL,
    ]),
    negative: settings.style.negative ?? '',
  }
}

export type PageArtPromptRequest = Omit<
  PageArtRequest,
  'layoutPng' | 'referencePng' | 'characterRefs'
>

/** ページ全体の生成の説明。配置図のどこが何かと、コマの枠を動かさないこと */
const PAGE_ART_HEAD =
  'one whole manga page drawn to the layout image: each grey area is a panel and the black lines are its border. Draw every panel inside its border and keep the gutters between panels white.'

const formatSpan = (from: number, size: number) => `${from.toFixed(2)}-${(from + size).toFixed(2)}`

/**
 * ページ全体の画像生成プロンプト。スタイル、配置図の説明、ページの登場キャラの外見、
 * コマごとの行（読み順の番号とページ内の範囲、その後に panelArt と同じ中身を名前だけのキャラで）、固定の末尾を改行で連結する。
 * negative は panelArt と同じ。
 */
function pageArt(req: PageArtPromptRequest): { prompt: string; negative: string } {
  const { settings, characters } = req.project
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
      settings.style.prompt,
      PAGE_ART_HEAD,
      cast.length > 0 ? `characters: ${cast.map(describeCharacter).join('; ')}` : undefined,
      ...panels,
      PANEL_ART_TAIL,
    ]),
    negative: settings.style.negative ?? '',
  }
}

/** キャラの参照画像の固定の末尾。コマの生成で参照しやすいよう、1 人を全身で正面から描かせる */
const CHARACTER_ART_TAIL =
  'character reference sheet, a single character, full body, front view, standing, plain white background, no text, no letters'

/** キャラの参照画像のプロンプト。画風、名前と外見、固定の末尾を改行で連結する */
function characterArt(req: CharacterArtRequest): { prompt: string; negative: string } {
  const { settings } = req.project
  const { name, appearance } = req.character
  return {
    prompt: [
      settings.style.prompt,
      appearance ? `${name}: ${appearance}` : name,
      CHARACTER_ART_TAIL,
    ]
      .filter(Boolean)
      .join('\n'),
    negative: settings.style.negative ?? '',
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
 * ページ割りのプロンプト。脚本をページに割り振り、ページごとの流れ、登場キャラ、セリフの配列を返させる。
 * system に出力規則と JSON Schema、user にキャラ一覧、ページ数、脚本を入れる。
 */
function planPages(req: PagePlanRequest): LlmPrompt {
  const schema = pagePlanJsonSchema()

  const system = [
    'You are a manga story editor. Split the script into pages and say roughly what happens on each page.',
    'Reply with the pages in reading order as JSON that conforms to the JSON Schema below.',
    '- note: what happens on the page, in the language of the script. Keep every action, stage direction, setting, sound effect and prop the script gives for this part; do not summarise them away.',
    '- cast: the ids of the listed characters who appear on the page. Empty when none appears.',
    '- lines: every line of dialogue, inner monologue and narration that falls on the page, in reading order, copied verbatim without the speaker name and brackets.',
    '  - speakerId: the id of the listed character who says it. Omit it for narration or when the speaker is not listed.',
    '  - shape: normal for speech, shout for shouting, thought for inner monologue, narration for narration and captions.',
    '- Every line of the script goes on exactly one page. Never drop, merge, shorten or paraphrase a line.',
    '- Give the key scenes more pages and keep transitions short. Put a reveal at the top of a page, not at the bottom.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')

  const user = [
    ...characterList(req.project.characters),
    req.pageCount === undefined
      ? `Pages: as many as the script needs, at most ${MAX_PLANNED_PAGES}.`
      : `Pages: exactly ${req.pageCount}.`,
    'Script:',
    req.script,
  ].join('\n')

  return { system, user, schema }
}

const POINT_JSON_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: { x: { type: 'number' }, y: { type: 'number' } },
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
function critique(req: CritiqueRequest): LlmPrompt {
  const { page, diagnosis } = req
  const schema = critiqueJsonSchema()

  const system = [
    'You are a manga editor who reviews how the eye flows across a storyboard page.',
    'You get the elements of one page and the result of an automatic diagnosis of the reading path. Explain the problems and propose fixes.',
    'Reply with one JSON object that conforms to the JSON Schema below, and nothing else.',
    'Rules:',
    '- Write summary and every message in Japanese. summary is two or three sentences about the overall eye flow and the main problems.',
    `- Give at most ${MAX_SUGGESTIONS} suggestions, most effective first. Each suggestion is one fix described by message and applied by patch.`,
    '- patch is a JSON Patch (RFC 6902) whose paths start at the page, for example /panels/3/focusPoints/1/pos. Indexes are the array indexes given in brackets, not panel order.',
    '- Only these operations are allowed: replace the pos of a focus point (/panels/<i>/focusPoints/<j>/pos), replace the pos of a bubble (/panels/<i>/bubbles/<j>/pos), and add a vector (/panels/<i>/vectors/-).',
    '- Never change panel rect, panel shape, panel order, or anything else. Never remove anything.',
    '- Coordinates are between 0 and 1, relative to the panel, with the origin at the top left.',
    '- A new vector has a new unique id that starts with "vc_ai_". Its sourceFocusId and targetFocusId, when set, are ids of focus points or bubbles of the same panel.',
    '- Prefer fixes that turn "miss" and "weak" focus points into "ok", that is, move them closer to the sweep path or add a strong vector toward them.',
    '- When the page has no problems, return an empty suggestions array.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')

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

  return { system, user, schema }
}

export const prompts = { panelArt, pageArt, characterArt, planPages, critique }

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
    expect(lines[0]).toBe(project.settings.style.prompt)
    expect(lines).toContain('ヒント')
    expect(lines).toContain('revise the previous image: 明るく')
    expect(lines.at(-1)).toBe(PANEL_ART_TAIL)
    expect(negative).toBe(project.settings.style.negative ?? '')
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
    expect(lines.slice(0, 2)).toEqual([project.settings.style.prompt, PAGE_ART_HEAD])
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
    expect(lines.at(-1)).toBe(PANEL_ART_TAIL)
    expect(negative).toBe(project.settings.style.negative ?? '')
  })

  test('pageArt leaves out the cast line and the colon for a bare page', () => {
    const bare: Page = {
      id: 'pg',
      side: 'single',
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
      project: { settings: { ...project.settings, style: { prompt: '' } }, characters: [] },
      page: bare,
    })
    expect(prompt.split('\n')).toEqual([
      PAGE_ART_HEAD,
      'panel 1 (x 0.00-1.00, y 0.00-1.00)',
      PANEL_ART_TAIL,
    ])
  })

  test('characterArt joins the style, the name with the appearance, and the fixed tail', () => {
    const character = { id: 'c', name: 'エル', shortName: 'L', appearance: '銀髪、黒いコート' }
    const { prompt, negative } = prompts.characterArt({
      project: { settings: { ...project.settings, style: { prompt: 'ink', negative: 'color' } } },
      character,
    })
    expect(prompt.split('\n')).toEqual(['ink', 'エル: 銀髪、黒いコート', CHARACTER_ART_TAIL])
    expect(negative).toBe('color')
    const bare = prompts.characterArt({
      project: { settings: { ...project.settings, style: { prompt: '' } } },
      character: { ...character, appearance: undefined },
    })
    expect(bare.prompt.split('\n')).toEqual(['エル', CHARACTER_ART_TAIL])
    expect(bare.negative).toBe('')
  })

  test('planPages embeds the page plan JSON Schema and lists characters, the page count and the script', () => {
    const { system, user, schema } = prompts.planPages({
      project: {
        settings: project.settings,
        characters: [{ id: 'chr_e', name: 'エリ', shortName: 'E' }],
      },
      script: 'E「こんにちは」\n森を歩く。',
      pageCount: 2,
    })
    expect(schema).toEqual(pagePlanJsonSchema())
    expect(system).toContain(`JSON Schema:\n${JSON.stringify(pagePlanJsonSchema())}`)
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
    expect(system).toContain('Never change panel rect')
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
