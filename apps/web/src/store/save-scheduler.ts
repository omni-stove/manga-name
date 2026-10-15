import type { Project } from '@manga/schema'
import type { StoreApi } from 'zustand/vanilla'
import type { ProjectStoreState } from './project-store'

export interface SaveScheduler {
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
