import type {
  Bubble,
  Character,
  FocusDiagnosis,
  FocusPoint,
  ID,
  Issue,
  Page,
  PageDiagnosis,
  Panel,
  PanelDiagnosis,
  Patch,
  ProjectSettings,
  Vector,
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
  /** 生成に参考画像の切り抜きを渡すか。ページに参考画像が無ければ undefined で、切り替えを出さない */
  useReference?: boolean
  onUseReferenceChange?(use: boolean): void
  /** 生成に診断の `hint` を渡すか。既定はオン */
  useHint?: boolean
  onUseHintChange?(use: boolean): void
  /** PanelArt.ref を表示用 URL にする */
  resolveAsset(ref: string): Promise<string>
}

export interface BubbleInspectorProps {
  bubble: Bubble
  characters: Character[]
  onChange(patch: Patch): void
}

export interface FocusInspectorProps {
  focus: FocusPoint
  characters: Character[]
  diagnosis?: FocusDiagnosis
  onChange(patch: Patch): void
}

export interface VectorInspectorProps {
  vector: Vector
  /** `targetFocusId` に選べる、同じコマの焦点とフキダシ */
  targets: readonly { value: ID; label: string }[]
  onChange(patch: Patch): void
}

export interface IssueListProps {
  issues: readonly Issue[]
  /** Issue が指す要素へ選択を移す */
  onFocus(issue: Issue): void
}

export interface CharacterInspectorProps {
  character: Character
  onChange(patch: Patch): void
  /** 参照画像を選ぶ UI を開く。選んだ結果は親が `referenceRef` の Patch にする */
  onPickReference(): void
  /** 外見から参照画像を生成する。結果は親が `referenceRef` の Patch にする */
  onGenerateReference(): void
  /** 参照画像を生成中。選ぶ・生成・外すを押せなくする */
  generating?: boolean
  resolveAsset(ref: string): Promise<string>
}

export interface PageInspectorProps {
  page: Page
  diagnosis?: PageDiagnosis
  /** 生成中。「このページを全部生成」を押せなくする */
  generating?: boolean
  onChange(patch: Patch): void
  onGenerateAll(): void
  /** 参考画像を選ぶ UI を開く。選んだ結果は親が `reference` の Patch にする */
  onPickReference(): void
}

export interface ProjectSettingsInspectorProps {
  settings: ProjectSettings
  onChange(patch: Patch): void
}
