import { type Patch, PatchSchema, type Project, ProjectSchema } from '@manga/schema'
import {
  applyPatches,
  enablePatches,
  type Patch as ImmerPatch,
  produce,
  produceWithPatches,
} from 'immer'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { toImmerPatch } from './json-patch'
import { createSaveScheduler } from './save-scheduler'

enablePatches()

export type PatchSource = 'user' | 'ai' | 'remote'

export interface PatchMeta {
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

interface HistoryEntry {
  forward: ImmerPatch[]
  inverse: ImmerPatch[]
  label?: string
}

/**
 * `initial` を起点に ProjectStore を作る。
 *
 * - applyPatch は JSON Patch（add / remove / replace）を順に適用し、結果が ProjectSchema を通るときだけ反映する。
 *   適用できない patch や不正な結果は throw し、状態と履歴は変えない。
 * - `user` と `ai` の変更は履歴に積み、updatedAt を更新する。`remote` は履歴にも updatedAt にも触れない。
 * - Undo / Redo も変更として updatedAt を更新し、保存する。
 * - 変更は `debounceMs` の debounce で saveProject に流す。保存は直列に行い、常にその時点の最新を書く。
 */
export function createProjectStore(
  initial: Project,
  options: ProjectStoreOptions,
): WebProjectStore {
  const {
    saveProject,
    debounceMs = 500,
    historyLimit = 200,
    now = () => new Date().toISOString(),
  } = options

  const state = createStore<ProjectStoreState>()(() => ({
    project: initial,
    canUndo: false,
    canRedo: false,
    saveStatus: 'saved',
  }))
  const undoStack: HistoryEntry[] = []
  let redoStack: HistoryEntry[] = []
  const saver = createSaveScheduler(state, saveProject, debounceMs)

  /** `next` を検証して反映する。不正なら ZodError を throw し、何も変えない */
  const commit = (next: Project, source: PatchSource, updateHistory: () => void) => {
    const stamped =
      source === 'remote'
        ? next
        : produce(next, (draft) => {
            draft.updatedAt = now()
          })
    const result = ProjectSchema.safeParse(stamped)
    if (!result.success) throw result.error
    updateHistory()
    // parse の出力ではなく stamped を入れるのは、Immer の構造共有を保って変わっていない部分の再描画を避けるため
    state.setState({
      project: stamped,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
    })
    saver.schedule()
  }

  return {
    state,
    flush: saver.flush,
    get: () => state.getState().project,
    applyPatch(patch, meta = { source: 'user' }) {
      const ops = PatchSchema.parse(patch)
      if (ops.length === 0) return
      const [next, forward, inverse] = produceWithPatches(state.getState().project, (draft) => {
        // 1 操作ずつ変換するのは、後ろの操作のパスが前の操作を適用した後の形で解決されるため
        for (const op of ops) applyPatches(draft, [toImmerPatch(draft, op)])
      })
      if (forward.length === 0) return
      commit(next, meta.source, () => {
        if (meta.source === 'remote') return
        undoStack.push({ forward, inverse, label: meta.label })
        if (undoStack.length > historyLimit) undoStack.shift()
        redoStack = []
      })
    },
    undo() {
      const entry = undoStack.at(-1)
      if (!entry) return
      commit(applyPatches(state.getState().project, entry.inverse), 'user', () => {
        undoStack.pop()
        redoStack.push(entry)
      })
    },
    redo() {
      const entry = redoStack.at(-1)
      if (!entry) return
      commit(applyPatches(state.getState().project, entry.forward), 'user', () => {
        redoStack.pop()
        undoStack.push(entry)
      })
    },
    subscribe(listener) {
      return state.subscribe((s, prev) => {
        if (s.project !== prev.project) listener(s.project)
      })
    },
  }
}

if (import.meta.vitest) {
  const { describeProjectStore } = await import('./project-store.suite')
  describeProjectStore('createProjectStore', createProjectStore)
}
