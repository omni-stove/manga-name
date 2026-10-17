import type { Project } from '@manga/schema'
import type { StoreApi } from 'zustand/vanilla'
import type { ProjectStoreState } from './project-store'

interface SaveScheduler {
  /** 変更があったことを伝える。最後の呼び出しから `debounceMs` 後に保存する */
  schedule(): void
  /** debounce を待たずに未保存の変更を保存する。保存が終わると resolve する。失敗しても reject しない */
  flush(): Promise<void>
}

/**
 * `state.project` を debounce して `saveProject` に流し、`state.saveStatus` を更新する。
 * 保存は直列に行い、常にその時点の最新を書く。
 */
export function createSaveScheduler(
  state: StoreApi<ProjectStoreState>,
  saveProject: (p: Project) => Promise<void>,
  debounceMs: number,
): SaveScheduler {
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

  return {
    flush,
    schedule() {
      dirty = true
      clearTimeout(timer)
      timer = setTimeout(() => void flush(), debounceMs)
      if (state.getState().saveStatus !== 'saving') state.setState({ saveStatus: 'pending' })
    },
  }
}

if (import.meta.vitest) {
  const { afterEach, beforeEach, describe, expect, test, vi } = import.meta.vitest
  const { createStore } = await import('zustand/vanilla')
  const { createEmptyProject } = await import('@manga/schema')

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const setup = (saveProject: (p: Project) => Promise<void> = async () => {}) => {
    const state = createStore<ProjectStoreState>()(() => ({
      project: createEmptyProject('t'),
      canUndo: false,
      canRedo: false,
      saveStatus: 'saved',
    }))
    const save = vi.fn(saveProject)
    const saver = createSaveScheduler(state, save, 100)
    const edit = (title: string) => {
      state.setState({ project: { ...state.getState().project, title } })
      saver.schedule()
    }
    return { state, save, saver, edit }
  }

  /** resolve を外から呼べる Promise。保存の途中の状態を見るのに使う */
  const deferred = () => {
    let resolve!: () => void
    let reject!: (e: unknown) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  describe('createSaveScheduler', () => {
    test('saves the latest project once, debounceMs after the last change', async () => {
      const { state, save, edit } = setup()
      edit('a')
      expect(state.getState().saveStatus).toBe('pending')
      await vi.advanceTimersByTimeAsync(99)
      edit('b')
      await vi.advanceTimersByTimeAsync(99)
      expect(save).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(save).toHaveBeenCalledOnce()
      expect(save.mock.calls[0]?.[0].title).toBe('b')
      expect(state.getState().saveStatus).toBe('saved')
    })

    test('flush saves without waiting and cancels the pending timer', async () => {
      const { state, save, saver, edit } = setup()
      edit('a')
      await saver.flush()
      expect(save).toHaveBeenCalledOnce()
      expect(state.getState().saveStatus).toBe('saved')
      await vi.advanceTimersByTimeAsync(1000)
      expect(save).toHaveBeenCalledOnce()
    })

    test('flush without changes does not save', async () => {
      const { save, saver } = setup()
      await saver.flush()
      expect(save).not.toHaveBeenCalled()
    })

    test('a change during a save keeps saving and is written after it, not concurrently', async () => {
      const first = deferred()
      const { state, save, saver, edit } = setup(() => first.promise)
      edit('a')
      const flushing = saver.flush()
      await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
      expect(state.getState().saveStatus).toBe('saving')
      edit('b')
      expect(state.getState().saveStatus).toBe('saving')
      const second = saver.flush()
      expect(save).toHaveBeenCalledOnce()

      save.mockImplementation(async () => {})
      first.resolve()
      await flushing
      await second
      expect(save.mock.calls.map(([p]) => p.title)).toEqual(['a', 'b'])
      expect(state.getState().saveStatus).toBe('saved')
    })

    test('a save that ends with unsaved changes reports pending', async () => {
      const first = deferred()
      const { state, saver, edit } = setup(() => first.promise)
      edit('a')
      const flushing = saver.flush()
      await vi.waitFor(() => expect(state.getState().saveStatus).toBe('saving'))
      edit('b')
      first.resolve()
      await flushing
      expect(state.getState().saveStatus).toBe('pending')
    })

    test('a failed save reports the error, does not reject, and retries on the next flush', async () => {
      const error = new Error('disk full')
      const { state, save, saver, edit } = setup(async () => {
        throw error
      })
      edit('a')
      await expect(saver.flush()).resolves.toBeUndefined()
      expect(state.getState()).toMatchObject({ saveStatus: 'error', saveError: error })

      save.mockImplementation(async () => {})
      await saver.flush()
      expect(save).toHaveBeenCalledTimes(2)
      expect(state.getState()).toMatchObject({ saveStatus: 'saved', saveError: undefined })
    })
  })
}
