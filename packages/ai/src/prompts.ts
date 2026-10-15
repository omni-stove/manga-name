import type { Character, ID, Panel, Point } from '@manga/schema'
import { findPanel, type PanelArtRequest } from './provider'

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

export const prompts = { panelArt }
