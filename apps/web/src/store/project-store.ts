import { PatchSchema, type Project, ProjectSchema } from '@manga/schema'
import {
  applyPatches,
  enablePatches,
  type Patch as ImmerPatch,
  produce,
  produceWithPatches,
} from 'immer'
import { createStore } from 'zustand/vanilla'
import { toImmerPatch } from './json-patch'
import type {
  PatchSource,
  ProjectStoreOptions,
  ProjectStoreState,
  WebProjectStore,
} from './project-store-types'
import { createSaveScheduler } from './save-scheduler'

enablePatches()

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
