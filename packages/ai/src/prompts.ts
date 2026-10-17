import {
  type Character,
  type ID,
  type JsonSchema,
  layoutProposalJsonSchema,
  type Page,
  type PageDiagnosis,
  type Panel,
  type Point,
  panelCharacterIds,
  StrengthSchema,
  VectorKindSchema,
} from '@manga/schema'
import {
  type CritiqueRequest,
  findPanel,
  type LayoutProposalRequest,
  type PanelArtRequest,
} from './provider'

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

/**
 * 画像生成プロンプト。parts の順に要素を改行で連結し、空の要素は飛ばす。
 * negative は settings.style.negative（無ければ空文字）。
 */
function panelArt(req: PanelArtPromptRequest): { prompt: string; negative: string } {
  const { settings, characters } = req.project
  const panel = findPanel(req.page, req.panelId)

  const focusByWeight = [...panel.focusPoints].sort((a, b) => b.weight - a.weight)
  const parts: (string | undefined)[] = [
    settings.style.prompt,
    panel.camera && `camera: ${panel.camera}`,
    panel.note,
    panelCharacters(panel, characters)
      .map((c) => (c.appearance ? `${c.name}: ${c.appearance}` : c.name))
      .join('; '),
    focusByWeight.map((f) => f.label).join('; '),
    panel.vectors
      .map(
        (v) =>
          `${v.kind} from ${endpointLabel(panel, v.sourceFocusId, v.from)} to ${endpointLabel(panel, v.targetFocusId, v.to)}`,
      )
      .join('; '),
    req.hint,
    req.instruction && `revise the previous image: ${req.instruction}`,
    PANEL_ART_TAIL,
  ]

  return {
    prompt: parts.filter((p): p is string => Boolean(p)).join('\n'),
    negative: settings.style.negative ?? '',
  }
}

/** ページあたりのコマ数の目安 */
const PANELS_PER_PAGE = { min: 3, max: 6 }

/**
 * レイアウト提案のプロンプト。system に出力規則と JSON Schema、user にキャラ一覧、
 * ページ数とコマ数の目安、脚本を入れる。
 */
function proposeLayout(req: LayoutProposalRequest): LlmPrompt {
  const { settings, characters } = req.project
  const schema = layoutProposalJsonSchema()

  const readingOrder =
    settings.direction === 'rtl'
      ? 'Reading order is right to left, then top to bottom: panel 1 is at the top right of the page, and bubble 1 is at the top right of its panel.'
      : 'Reading order is left to right, then top to bottom: panel 1 is at the top left of the page, and bubble 1 is at the top left of its panel.'

  const system = [
    'You are a manga storyboard artist. Split the script into pages and panels, and lay out speech bubbles and direction notes for each panel.',
    'Reply with one JSON object that conforms to the JSON Schema below, and nothing else.',
    'Rules:',
    '- Every id starts with "tmp_" and is unique within the reply.',
    '- All coordinates and sizes are between 0 and 1 with the origin at the top left. Panel rect is relative to the page. Bubble pos and size, focus point pos, and vector from and to are relative to their panel.',
    '- Panels on a page do not overlap. Panel order and bubble order start at 1 and follow the reading order.',
    `- ${readingOrder}`,
    '- Copy each line of dialogue from the script into bubbles[].text as written, in its original language. Use shape "narration" for narration, "thought" for inner voice, "shout" for shouting, and "normal" otherwise.',
    '- Set bubbles[].speakerId to the id of the speaking character from the character list. Omit it for narration or when the speaker is unknown.',
    '- Set cast to the ids of every character from the character list who is visible in the panel, including those who do not speak. Omit it when no listed character is visible.',
    '- Put the stage directions of the script into the panel note, in the original language. Set camera to the shot you infer, such as ロング, ミドル, アップ, アオリ, 俯瞰.',
    '- arts and scribbles are empty arrays. Omit artId, sweep, shape, reference, and bubbles[].overflow.',
    '- rationale briefly explains how the script was split into pages and panels.',
    'JSON Schema:',
    JSON.stringify(schema),
  ].join('\n')

  const user = [
    'Characters:',
    ...(characters.length > 0
      ? characters.map((c) => `- id: ${c.id}, name: ${c.name}, shortName: ${c.shortName}`)
      : ['- (none)']),
    req.pageCount === undefined
      ? 'Pages: as many as the script needs.'
      : `Pages: about ${req.pageCount}.`,
    `Panels per page: ${PANELS_PER_PAGE.min} to ${PANELS_PER_PAGE.max}.`,
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

export const prompts = { panelArt, proposeLayout, critique }

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')

  const project = fixtures.samplePage01

  test('proposeLayout embeds the layout proposal JSON Schema and returns it as schema', () => {
    const { system, schema } = prompts.proposeLayout({ project, script: 's' })
    expect(schema).toEqual(layoutProposalJsonSchema())
    expect(system).toContain(`JSON Schema:\n${JSON.stringify(layoutProposalJsonSchema())}`)
    expect(system).toContain('"tmp_"')
    expect(system).toContain('right to left')
  })

  test('proposeLayout lists characters, the page count and the script', () => {
    const { user } = prompts.proposeLayout({
      project: {
        settings: project.settings,
        characters: [{ id: 'chr_e', name: 'エリ', shortName: 'E' }],
      },
      script: 'E「こんにちは」\n森を歩く。',
      pageCount: 2,
    })
    expect(user).toBe(
      [
        'Characters:',
        '- id: chr_e, name: エリ, shortName: E',
        'Pages: about 2.',
        'Panels per page: 3 to 6.',
        'Script:',
        'E「こんにちは」',
        '森を歩く。',
      ].join('\n'),
    )
  })

  test('proposeLayout follows the reading direction and handles no characters', () => {
    const { system, user } = prompts.proposeLayout({
      project: { settings: { ...project.settings, direction: 'ltr' }, characters: [] },
      script: 's',
    })
    expect(system).toContain('left to right')
    expect(user).toContain('- (none)\nPages: as many as the script needs.')
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
