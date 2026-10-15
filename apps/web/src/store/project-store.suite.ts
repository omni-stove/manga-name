import { createEmptyProject, fixtures, type Patch, type Project } from '@manga/schema'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProjectStoreOptions, WebProjectStore } from './project-store'

type ProjectStoreFactory = (initial: Project, options: ProjectStoreOptions) => WebProjectStore

/**
 * ProjectStore の実装が満たすテスト。Immer 実装と Yjs 実装の両方から、各ファイルの in-source テストで呼ぶ。
 */
export function describeProjectStore(name: string, createStore: ProjectStoreFactory): void {
  const NOW = '2026-10-15T00:00:00.000Z'
  const setup = (project: Project = createEmptyProject('t')) => {
    const saveProject = vi.fn(async (_p: Project) => {})
    const store = createStore(project, { saveProject, now: () => NOW })
    return { store, saveProject, initial: project }
  }
  const setTitle = (title: string): Patch => [{ op: 'replace', path: '/title', value: title }]

  describe(name, () => {
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
        { op: 'replace', path: `/characters/${project.characters.length}/name`, value: 'B' },
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
      const store = createStore(createEmptyProject('t'), {
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
      store.applyPatch([{ op: 'replace', path: '/settings/dpi', value: 600 }], {
        source: 'remote',
      })
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
  })
}
