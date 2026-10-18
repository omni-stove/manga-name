import type { Patch, Project } from '@manga/schema'
import type { StoreApi } from 'zustand/vanilla'

export type PatchSource = 'user' | 'ai' | 'remote'

interface PatchMeta {
  source: PatchSource
  /** 履歴の表示名。例 "コマを移動" */
  label?: string
}

/** Project を JSON Patch で変える store。Zustand 版と Yjs 版が同じ形を持つので、呼び出し側は実装を選ばない */
export interface ProjectStore {
  get(): Project
  applyPatch(patch: Patch, meta?: PatchMeta): void
  subscribe(listener: (p: Project) => void): () => void
  undo(): void
  redo(): void
}

/**
 * - `saved`: 最後の変更まで保存済み
 * - `pending`: 保存されていない変更がある
 * - `saving`: saveProject の完了待ち
 * - `error`: 直前の保存が失敗した。次の変更か flush で再試行する
 */
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

export interface ProjectStoreState {
  project: Project
  canUndo: boolean
  canRedo: boolean
  saveStatus: SaveStatus
  /** saveStatus が `error` のときの原因 */
  saveError?: unknown
}

/** apps/web が使う ProjectStore。React からは `useStore(store.state, selector)` で購読する */
export interface WebProjectStore extends ProjectStore {
  readonly state: StoreApi<ProjectStoreState>
  /** debounce を待たずに未保存の変更を保存する。保存が終わると resolve する。失敗しても reject しない */
  flush(): Promise<void>
}

export interface ProjectStoreOptions {
  /** StorageAdapter.saveProject を渡す */
  saveProject(p: Project): Promise<void>
  /** 最後の変更から保存までの待ち時間。既定 500ms */
  debounceMs?: number
  /** Undo できる最大ステップ数。既定 200 */
  historyLimit?: number
  /** updatedAt に入れる現在時刻 */
  now?: () => string
}
