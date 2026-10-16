import type { Character, ID, Page, PageDiagnosis, Patch, ProjectSettings } from '@manga/schema'

export type Selection = { kind: 'panel' | 'bubble' | 'focus' | 'vector'; id: ID } | null

export type Tool = 'select' | 'panel' | 'bubble' | 'focus' | 'vector' | 'scribble'

/** `scribble` ツールで使うペンの色か消しゴム */
export type ScribbleTool = 'ink' | 'red' | 'blue' | 'eraser'

export interface Layers {
  reference: boolean
  art: boolean
  scribble: boolean
  hints: boolean
  diagnosis: boolean
}

export interface EditorCanvasProps {
  page: Page
  settings: ProjectSettings
  characters: Character[]
  /** Phase 2 の診断オーバーレイ用。null で動く */
  diagnosis: PageDiagnosis | null
  selection: Selection
  tool: Tool
  /** `tool === 'scribble'` のときの色か消しゴム。既定は ink */
  scribbleTool?: ScribbleTool
  layers: Layers
  /** 生成中のコマ。スピナーを重ねる */
  generating: Set<ID>
  /** page を root とした JSON Patch */
  onChange(patch: Patch): void
  onSelect(sel: Selection): void
  /** コマのホバーに出す「生成」ボタン */
  onGenerate?(panelId: ID): void
  /** PanelArt.ref と Page.reference.ref を表示用 URL にする */
  resolveAsset(ref: string): Promise<string>
}
