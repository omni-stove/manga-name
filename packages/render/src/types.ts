import type { Character, ProjectSettings } from '@manga/schema'

export interface RenderContext {
  settings: ProjectSettings
  characters: Character[]
  loadAsset(ref: string): Promise<Blob>
}

export interface RenderOptions {
  /** 出力幅 px。省略時は pageSize と dpi から計算 */
  width?: number
  /** 指示メモの印字。'margin' はコマ横の余白、'sheet' は exportPdf が別ページを作るので renderPage では 'none' と同じ */
  notes: 'none' | 'margin' | 'sheet'
  panelNumbers: boolean
}
