import type {
  Bubble,
  Character,
  Page,
  PageDiagnosis,
  Panel,
  PanelDiagnosis,
  Patch,
  ProjectSettings,
} from '@manga/schema'

/** どの Inspector も `onChange` の path は渡したオブジェクトを root とする */
export interface PanelInspectorProps {
  panel: Panel
  characters: Character[]
  diagnosis?: PanelDiagnosis
  /** 生成中。「生成」と「修正して再生成」を押せなくする */
  generating?: boolean
  onChange(patch: Patch): void
  /** instruction 付きは採用中の絵への修正指示つき再生成 */
  onGenerate(instruction?: string): void
  /** PanelArt.ref を表示用 URL にする */
  resolveAsset(ref: string): Promise<string>
}

export interface BubbleInspectorProps {
  bubble: Bubble
  characters: Character[]
  onChange(patch: Patch): void
}

export interface CharacterInspectorProps {
  character: Character
  onChange(patch: Patch): void
  /** 参照画像を選ぶ UI を開く。選んだ結果は親が `referenceRef` の Patch にする */
  onPickReference(): void
  resolveAsset(ref: string): Promise<string>
}

export interface PageInspectorProps {
  page: Page
  diagnosis?: PageDiagnosis
  /** 生成中。「このページを全部生成」を押せなくする */
  generating?: boolean
  onChange(patch: Patch): void
  onGenerateAll(): void
}

export interface ProjectSettingsInspectorProps {
  settings: ProjectSettings
  onChange(patch: Patch): void
}
