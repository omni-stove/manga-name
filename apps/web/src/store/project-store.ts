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

enablePatches()

export type PatchSource = 'user' | 'ai' | 'remote'

export interface PatchMeta {
  source: PatchSource
  /** 履歴の表示名。例 "コマを移動" */
  label?: string
}

/** docs/03-data-model.md の ProjectStore */
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
export function createProjectStore(initial: Project, options: ProjectStoreOptions): WebProjectStore {
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

  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  let queue: Promise<void> = Promise.resolve()

  const saveLatest = async () => {
    // 先に並んだ保存が最新を書いていれば、重ねて書かない
    if (!dirty) return
    dirty = false
    state.setState({ saveStatus: 'saving', saveError: undefined })
    try {
      await saveProject(state.getState().project)
      state.setState({ saveStatus: dirty ? 'pending' : 'saved' })
    } catch (error) {
      dirty = true
      state.setState({ saveStatus: 'error', saveError: error })
    }
  }

  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    // 前の保存の完了を待つのは、古い内容の書き込みが後から終わって新しい内容を上書きしないため
    if (dirty) queue = queue.then(saveLatest)
    return queue
  }

  const scheduleSave = () => {
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), debounceMs)
    if (state.getState().saveStatus !== 'saving') state.setState({ saveStatus: 'pending' })
  }

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
    scheduleSave()
  }

  return {
    state,
    flush,
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
  const { afterEach, beforeEach, describe, expect, test, vi } = import.meta.vitest
  const { createEmptyProject, fixtures } = await import('@manga/schema')

  const NOW = '2026-10-15T00:00:00.000Z'
  const setup = (project: Project = createEmptyProject('t')) => {
    const saveProject = vi.fn(async (_p: Project) => {})
    const store = createProjectStore(project, { saveProject, now: () => NOW })
    return { store, saveProject, initial: project }
  }
  const setTitle = (title: string): Patch => [{ op: 'replace', path: '/title', value: title }]

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('applyPatch updates the project, stamps updatedAt and notifies subscribers', () => {
    const { store, initial } = setup()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.applyPatch(setTitle('a'))
    expect(store.get()).toMatchObject({ title: 'a', updatedAt: NOW })
    expect(store.get().settings).toBe(initial.settings)
    expect(listener).toHaveBeenCalledExactlyOnceWith(store.get())
    unsubscribe()
    store.applyPatch(setTitle('b'))
    expect(listener).toHaveBeenCalledOnce()
  })

  test('applies operations in order, so later paths see earlier ones', () => {
    const project = fixtures.samplePage01
    const { store } = setup(project)
    const panels = project.episodes[0]?.pages[0]?.panels ?? []
    const [p1, p2] = panels
    if (!p1 || !p2) throw new Error('fixture に panel が 2 つない')
    store.applyPatch([
      { op: 'replace', path: '/episodes/0/pages/0/panels/0/order', value: p2.order },
      { op: 'replace', path: '/episodes/0/pages/0/panels/1/order', value: p1.order },
      { op: 'add', path: '/characters/-', value: { id: 'c1', name: 'A', shortName: 'A' } },
      { op: 'replace', path: '/characters/0/name', value: 'B' },
    ])
    const page = store.get().episodes[0]?.pages[0]
    expect(page?.panels.map((p) => p.order).slice(0, 2)).toEqual([p2.order, p1.order])
    expect(store.get().characters.at(-1)?.name).toBe('B')
  })

  describe('rejects a patch without changing state or history', () => {
    test.each([
      ['unsupported op', [{ op: 'move', path: '/title', from: '/id' }]],
      ['missing path', [{ op: 'replace', path: '/nope', value: 1 }]],
      ['schema violation', [{ op: 'replace', path: '/settings/dpi', value: 'high' }]],
      [
        'violation by a later op',
        [
          { op: 'replace', path: '/title', value: 'ok' },
          { op: 'remove', path: '/settings' },
        ],
      ],
    ])('%s', async (_name, patch) => {
      const { store, initial, saveProject } = setup()
      store.applyPatch(setTitle('a'))
      const before = store.get()
      expect(() => store.applyPatch(patch as Patch)).toThrow()
      expect(store.get()).toBe(before)
      store.undo()
      expect(store.get().title).toBe(initial.title)
      expect(store.state.getState().canUndo).toBe(false)
      await vi.runAllTimersAsync()
      expect(saveProject).toHaveBeenCalledOnce()
    })
  })

  test('a no-op patch adds no history and schedules no save', async () => {
    const { store, initial, saveProject } = setup()
    store.applyPatch([])
    store.applyPatch(setTitle(initial.title))
    expect(store.get()).toBe(initial)
    expect(store.state.getState()).toMatchObject({ canUndo: false, saveStatus: 'saved' })
    await vi.runAllTimersAsync()
    expect(saveProject).not.toHaveBeenCalled()
  })

  test('Undo / Redo work across 150 steps', () => {
    const { store, initial } = setup()
    for (let i = 1; i <= 150; i++) store.applyPatch(setTitle(`t${i}`), { source: 'user' })
    for (let i = 149; i >= 1; i--) {
      store.undo()
      expect(store.get().title).toBe(`t${i}`)
    }
    store.undo()
    expect(store.get().title).toBe(initial.title)
    expect(store.state.getState()).toMatchObject({ canUndo: false, canRedo: true })
    store.undo()
    expect(store.get().title).toBe(initial.title)

    for (let i = 1; i <= 150; i++) {
      store.redo()
      expect(store.get().title).toBe(`t${i}`)
    }
    expect(store.state.getState()).toMatchObject({ canUndo: true, canRedo: false })
  })

  test('history is capped at historyLimit', () => {
    const store = createProjectStore(createEmptyProject('t'), {
      saveProject: async () => {},
      historyLimit: 3,
    })
    for (let i = 1; i <= 5; i++) store.applyPatch(setTitle(`t${i}`))
    for (let i = 0; i < 5; i++) store.undo()
    expect(store.get().title).toBe('t2')
  })

  test('a new change clears the redo stack', () => {
    const { store } = setup()
    store.applyPatch(setTitle('a'))
    store.applyPatch(setTitle('b'))
    store.undo()
    store.applyPatch(setTitle('c'), { source: 'ai', label: '提案を適用' })
    expect(store.state.getState().canRedo).toBe(false)
    store.redo()
    expect(store.get().title).toBe('c')
    store.undo()
    expect(store.get().title).toBe('a')
  })

  test('remote patches are not recorded in history', () => {
    const { store, initial } = setup()
    store.applyPatch(setTitle('mine'))
    store.applyPatch([{ op: 'replace', path: '/settings/dpi', value: 600 }], { source: 'remote' })
    expect(store.get().settings.dpi).toBe(600)

    store.undo()
    expect(store.get().title).toBe(initial.title)
    expect(store.get().settings.dpi).toBe(600)
    expect(store.state.getState().canUndo).toBe(false)
  })

  test('remote patches alone leave nothing to undo and keep updatedAt', () => {
    const { store, initial } = setup()
    store.applyPatch(setTitle('theirs'), { source: 'remote' })
    expect(store.get().updatedAt).toBe(initial.updatedAt)
    expect(store.state.getState().canUndo).toBe(false)
    store.undo()
    expect(store.get().title).toBe('theirs')
  })

  test('consecutive changes call saveProject once, 500ms after the last one', async () => {
    const { store, saveProject } = setup()
    for (let i = 1; i <= 10; i++) {
      store.applyPatch(setTitle(`t${i}`))
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(saveProject).not.toHaveBeenCalled()
    expect(store.state.getState().saveStatus).toBe('pending')

    await vi.advanceTimersByTimeAsync(399)
    expect(saveProject).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(saveProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 't10' }))
    await store.flush()
    expect(store.state.getState().saveStatus).toBe('saved')

    await vi.advanceTimersByTimeAsync(5000)
    expect(saveProject).toHaveBeenCalledOnce()
  })

  test('flush saves immediately and serialises with an in-flight save', async () => {
    const { store, saveProject } = setup()
    let release = () => {}
    saveProject.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve()
        }),
    )
    store.applyPatch(setTitle('a'))
    const first = store.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.state.getState().saveStatus).toBe('saving')

    store.applyPatch(setTitle('b'))
    const second = store.flush()
    expect(saveProject).toHaveBeenCalledOnce()
    release()
    await first
    await second
    expect(saveProject).toHaveBeenCalledTimes(2)
    expect(saveProject.mock.lastCall?.[0].title).toBe('b')
    expect(store.state.getState().saveStatus).toBe('saved')
  })

  test('a failed save reports the error and is retried on the next flush', async () => {
    const { store, saveProject } = setup()
    const error = new Error('quota exceeded')
    saveProject.mockRejectedValueOnce(error)
    store.applyPatch(setTitle('a'))
    await store.flush()
    expect(store.state.getState()).toMatchObject({ saveStatus: 'error', saveError: error })

    await store.flush()
    expect(saveProject).toHaveBeenCalledTimes(2)
    expect(store.state.getState()).toMatchObject({ saveStatus: 'saved', saveError: undefined })
  })
}
