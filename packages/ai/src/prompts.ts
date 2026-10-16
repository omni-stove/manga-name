import {
  type Character,
  type ID,
  layoutProposalJsonSchema,
  type Panel,
  type Point,
} from '@manga/schema'
import { findPanel, type LayoutProposalRequest, type PanelArtRequest } from './provider'

/** LLM の構造化出力に渡す JSON Schema */
export type JsonSchema = ReturnType<typeof layoutProposalJsonSchema>

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

/** コマに登場するキャラ。bubbles の speakerId と focusPoints の characterId を登場順に集める */
function panelCharacters(panel: Panel, characters: Character[]): Character[] {
  const ids = [
    ...panel.bubbles.map((b) => b.speakerId),
    ...panel.focusPoints.map((f) => f.characterId),
  ].filter((id): id is ID => id !== undefined)
  const unique = [...new Set(ids)]
  return unique.flatMap((id) => characters.filter((c) => c.id === id))
}

/**
 * 画像生成プロンプト。WS-03 の順に要素を改行で連結し、空の要素は飛ばす。
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
    '- Put the stage directions of the script into the panel note, in the original language. Set camera to the shot you infer, such as ロング, ミドル, アップ, アオリ, 俯瞰.',
    '- arts and scribbles are empty arrays. Omit artId, sweep, and reference.',
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

export const prompts = { panelArt, proposeLayout }

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
}
