import type {
  Character,
  FocusKind,
  ID,
  Page,
  PageDiagnosis,
  Patch,
  ProjectSettings,
} from '@manga/schema'

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
  /** 視線誘導診断。null なら診断のレイヤーを描かない */
  diagnosis: PageDiagnosis | null
  /**
   * 提案を仮適用したページ。`page` と比べて動いた焦点とフキダシ、増えたベクトルを、
   * 元の位置と提案の位置の両方で破線で重ねる。操作は受けない
   */
  ghostPage?: Page
  selection: Selection
  tool: Tool
  /** `tool === 'scribble'` のときの色か消しゴム。既定は ink */
  scribbleTool?: ScribbleTool
  /** `focus` ツールで置く焦点の種別。ツールバーで選ぶ。既定は face */
  focusKind?: FocusKind
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
