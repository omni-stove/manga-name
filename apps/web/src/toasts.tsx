import { ToastList } from '@manga/ui'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

type ToastKind = 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastState {
  toasts: readonly Toast[]
}

/** 画面の隅に出す通知。生成の失敗のように、どの画面にいても出したい知らせに使う */
export interface ToastStore {
  readonly state: StoreApi<ToastState>
  /** 通知を追加する。`ttlMs` が過ぎると自動で消える。0 なら消さない */
  push(message: string, kind?: ToastKind): number
  dismiss(id: number): void
}

function createToastStore(ttlMs = 8000): ToastStore {
  const state = createStore<ToastState>()(() => ({ toasts: [] }))
  let nextId = 1
  const dismiss = (id: number) =>
    state.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  return {
    state,
    dismiss,
    push(message, kind = 'error') {
      const id = nextId++
      state.setState((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
      if (ttlMs > 0) setTimeout(() => dismiss(id), ttlMs)
      return id
    },
  }
}

/** アプリ全体で 1 つの通知置き場 */
export const toasts = createToastStore()

export function Toasts({ store = toasts }: { store?: ToastStore }) {
  const { toasts: items } = useStore(store.state)
  return <ToastList items={items} onDismiss={store.dismiss} />
}

if (import.meta.vitest) {
  const { expect, test, vi } = import.meta.vitest

  test('push adds a toast that dismiss removes', () => {
    const store = createToastStore(0)
    const id = store.push('失敗')
    expect(store.state.getState().toasts).toEqual([{ id, kind: 'error', message: '失敗' }])
    store.dismiss(id)
    expect(store.state.getState().toasts).toEqual([])
  })

  test('a toast goes away after ttlMs', () => {
    vi.useFakeTimers()
    try {
      const store = createToastStore(100)
      store.push('x', 'info')
      vi.advanceTimersByTime(99)
      expect(store.state.getState().toasts).toHaveLength(1)
      vi.advanceTimersByTime(1)
      expect(store.state.getState().toasts).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
}
