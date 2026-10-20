import { migrate, PatchSchema, type Project, ProjectSchema, parseProject } from '@manga/schema'
import {
  applyPatches,
  enablePatches,
  type Patch as ImmerPatch,
  produce,
  produceWithPatches,
} from 'immer'
import * as Y from 'yjs'
import { createStore } from 'zustand/vanilla'
import { toImmerPatch } from './json-patch'
import type { ProjectStoreOptions, ProjectStoreState, WebProjectStore } from './project-store-types'
import { createSaveScheduler } from './save-scheduler'
import { applyPatchToY, applyYEvents, writeYChanges, writeYMap } from './yjs-mapping'

enablePatches()

/** Project を置く Y.Doc の共有型の名前 */
export const PROJECT_ROOT = 'project'

export interface YjsProjectStoreOptions extends ProjectStoreOptions {
  /** Project を置く Y.Doc。既に Project を持っていればそれを起点にし、`initial` は使わない。省略時は新しく作る */
  doc?: Y.Doc
  /** 古い版の Y.Doc を開いたとき、移行した版と内容を書き戻すか。既定 true。サーバが版の変更を許さないロールでは false にして、読むだけにする */
  writeBackVersion?: boolean
}

/** Yjs 版の ProjectStore。同期プロバイダは `doc` をつなぐ */
export interface YjsProjectStore extends WebProjectStore {
  readonly doc: Y.Doc
  /** Y.Doc の購読と UndoManager を外す。Y.Doc 自体は破棄しない */
  destroy(): void
}

/**
 * Project を Y.Doc の `PROJECT_ROOT` に Y.Map / Y.Array として置き、ProjectStore を作る。
 *
 * - applyPatch は JSON Patch を検証してから Yjs のトランザクションとして適用する。
 *   適用できない patch や ProjectSchema を通らない結果は throw し、Y.Doc と履歴は変えない。
 * - `user` と `ai` の変更は Y.UndoManager の履歴に積み、updatedAt を更新する。`remote` は履歴にも updatedAt にも触れない。
 * - Undo / Redo はこの store が入れた変更だけを戻す。他のクライアントから届いた変更は残る。
 * - 他のクライアントの更新が `doc` に届くと project を更新して購読者に通知する。
 * - 変更は `debounceMs` の debounce で saveProject に流す。
 */
export function createYjsProjectStore(
  initial: Project,
  options: YjsProjectStoreOptions,
): YjsProjectStore {
  const {
    saveProject,
    debounceMs = 500,
    historyLimit = 200,
    now = () => new Date().toISOString(),
    doc = new Y.Doc(),
    writeBackVersion = true,
  } = options

  const root = doc.getMap<unknown>(PROJECT_ROOT)
  // origin を store ごとに作るのは、同じ Y.Doc を見る別の store の変更をこの store の Undo に混ぜないため
  const local = Symbol('local')
  const untracked = Symbol('untracked')

  let project: Project
  if (root.size === 0) {
    doc.transact(() => writeYMap(root, initial), untracked)
    project = initial
  } else {
    const stored = root.toJSON()
    project = parseProject(stored)
    if (writeBackVersion && stored.schemaVersion !== project.schemaVersion) {
      // ProjectSchema が読み捨てる古いキーまで消さないよう、parse 前の移行結果との差だけを書く
      const migrated = migrate(stored) as Record<string, unknown>
      doc.transact(() => writeYChanges(root, stored, migrated), untracked)
    }
  }

  const state = createStore<ProjectStoreState>()(() => ({
    project,
    canUndo: false,
    canRedo: false,
    saveStatus: 'saved',
  }))
  const saver = createSaveScheduler(state, saveProject, debounceMs)

  // captureTimeout を 0 にするのは、applyPatch 1 回を Undo 1 回に対応させるため
  const undoManager = new Y.UndoManager(root, {
    trackedOrigins: new Set([local]),
    captureTimeout: 0,
  })
  undoManager.on('stack-item-added', () => {
    if (undoManager.undoStack.length <= historyLimit) return
    const dropped = undoManager.undoStack.shift()
    if (!dropped) return
    // shift だけでは StackItem が付けた keep が残り、削除済みの内容が GC されないため、clear() と同じく外す
    doc.transact((tr) => {
      Y.iterateDeletedStructs(tr, dropped.deletions, (struct) => {
        if (struct instanceof Y.Item) struct.keep = false
      })
    }, untracked)
  })

  // 1 回の操作が複数のトランザクションになっても、購読者への通知と保存の予約を 1 回にまとめる
  let depth = 0
  let derived: Project | undefined

  const publish = () => {
    const current = state.getState()
    const next = {
      project: derived ?? current.project,
      canUndo: undoManager.undoStack.length > 0,
      canRedo: undoManager.redoStack.length > 0,
    }
    derived = undefined
    if (
      next.project === current.project &&
      next.canUndo === current.canUndo &&
      next.canRedo === current.canRedo
    ) {
      return
    }
    state.setState(next)
    if (next.project !== current.project) saver.schedule()
  }

  const batch = (fn: () => void) => {
    depth++
    try {
      fn()
    } finally {
      depth--
      if (depth === 0) publish()
    }
  }

  const onEvents = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    derived = produce(derived ?? state.getState().project, (draft) => applyYEvents(draft, events))
    if (depth === 0) publish()
  }
  root.observeDeep(onEvents)

  // Undo / Redo が戻した updatedAt を現在時刻で上書きする。追跡しない origin にして Undo の履歴に積まない
  const stamp = (updatedAt: string) =>
    doc.transact(() => root.set('updatedAt', updatedAt), untracked)

  return {
    doc,
    state,
    flush: saver.flush,
    get: () => state.getState().project,
    applyPatch(patch, meta = { source: 'user' }) {
      const ops = PatchSchema.parse(patch)
      if (ops.length === 0) return
      const resolved: ImmerPatch[] = []
      const [next, forward] = produceWithPatches(state.getState().project, (draft) => {
        // 1 操作ずつ変換するのは、後ろの操作のパスが前の操作を適用した後の形で解決されるため
        for (const op of ops) {
          const p = toImmerPatch(draft, op)
          resolved.push(p)
          applyPatches(draft, [p])
        }
      })
      if (forward.length === 0) return
      const remote = meta.source === 'remote'
      const updatedAt = remote ? next.updatedAt : now()
      const result = ProjectSchema.safeParse(remote ? next : { ...next, updatedAt })
      if (!result.success) throw result.error

      batch(() => {
        // 他のクライアントへ届く更新を 1 回にするため、updatedAt も同じトランザクションで書く。Undo / Redo の後には stamp で書き直す
        doc.transact(
          () => {
            for (const p of resolved) applyPatchToY(root, p)
            if (!remote) root.set('updatedAt', updatedAt)
          },
          remote ? untracked : local,
        )
      })
    },
    undo() {
      batch(() => {
        if (undoManager.undo() !== null) stamp(now())
      })
    },
    redo() {
      batch(() => {
        if (undoManager.redo() !== null) stamp(now())
      })
    },
    subscribe(listener) {
      return state.subscribe((s, prev) => {
        if (s.project !== prev.project) listener(s.project)
      })
    },
    destroy() {
      root.unobserveDeep(onEvents)
      undoManager.destroy()
    },
  }
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { createEmptyProject } = await import('@manga/schema')
  const { describeProjectStore } = await import('./project-store.suite')

  describeProjectStore('createYjsProjectStore', createYjsProjectStore)

  describe('createYjsProjectStore with other clients', () => {
    const NOW = '2026-10-15T00:00:00.000Z'
    const options = () => ({ saveProject: vi.fn(async (_p: Project) => {}), now: () => NOW })
    const copyDoc = (source: Y.Doc) => {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(source))
      return doc
    }
    /** 2 つの Y.Doc の更新を互いに流す。y-websocket の代わり */
    const connect = (a: Y.Doc, b: Y.Doc) => {
      const peer = Symbol('peer')
      const forwardTo = (to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
        if (origin !== peer) Y.applyUpdate(to, update, peer)
      }
      a.on('update', forwardTo(b))
      b.on('update', forwardTo(a))
    }
    const setup = () => {
      const initial = createEmptyProject('t')
      const a = createYjsProjectStore(initial, options())
      const b = createYjsProjectStore(createEmptyProject('ignored'), {
        ...options(),
        doc: copyDoc(a.doc),
      })
      return { initial, a, b }
    }
    const setTitle = (title: string) => [{ op: 'replace' as const, path: '/title', value: title }]
    const setDpi = (dpi: number) => [{ op: 'replace' as const, path: '/settings/dpi', value: dpi }]

    test('a store on a doc that already holds a project starts from it', () => {
      const { initial, b } = setup()
      expect(b.get()).toEqual(initial)
    })

    test('a doc that does not hold a valid project is rejected', () => {
      const doc = new Y.Doc()
      doc.getMap(PROJECT_ROOT).set('title', 1)
      const create = () => createYjsProjectStore(createEmptyProject('t'), { ...options(), doc })
      expect(create).toThrow()
    })

    test('an older doc is migrated, and written back only when the role may write', () => {
      const old = () => {
        const project = createEmptyProject('t')
        const json = structuredClone(project) as unknown as Record<string, unknown>
        const panel = { id: 'pn', order: 1, rect: { x: 0, y: 0, w: 1, h: 1 } }
        const empty = { bubbles: [], focusPoints: [], vectors: [], arts: [] }
        const page = {
          id: 'pg',
          side: 'single',
          scribbles: [],
          panels: [{ ...panel, ...empty, camera: 'ロング' }],
        }
        const doc = new Y.Doc()
        writeYMap(doc.getMap(PROJECT_ROOT), {
          ...json,
          schemaVersion: 12,
          episodes: [{ id: 'ep', title: '', pages: [page] }],
        })
        return doc
      }
      const panelOf = (doc: Y.Doc) =>
        (doc.getMap(PROJECT_ROOT).toJSON() as Project).episodes[0]?.pages[0]?.panels[0]

      const writer = createYjsProjectStore(createEmptyProject('x'), { ...options(), doc: old() })
      expect(writer.get().episodes[0]?.pages[0]?.panels[0]?.camera).toBe('long')
      expect(writer.doc.getMap(PROJECT_ROOT).get('schemaVersion')).toBe(16)
      expect(panelOf(writer.doc)?.camera).toBe('long')

      const reader = createYjsProjectStore(createEmptyProject('x'), {
        ...options(),
        doc: old(),
        writeBackVersion: false,
      })
      expect(reader.get().episodes[0]?.pages[0]?.panels[0]?.camera).toBe('long')
      expect(reader.doc.getMap(PROJECT_ROOT).get('schemaVersion')).toBe(12)
      expect(panelOf(reader.doc)?.camera).toBe('ロング')
    })

    test('changes reach the other client and notify its subscribers', () => {
      const { a, b } = setup()
      connect(a.doc, b.doc)
      const listener = vi.fn()
      b.subscribe(listener)
      a.applyPatch(setTitle('from a'))
      expect(b.get().title).toBe('from a')
      expect(listener).toHaveBeenCalledExactlyOnceWith(b.get())
      expect(b.state.getState()).toMatchObject({ canUndo: false, saveStatus: 'pending' })
    })

    test('undo reverts only the changes made by this store', () => {
      const { initial, a, b } = setup()
      connect(a.doc, b.doc)
      a.applyPatch(setTitle('from a'))
      b.applyPatch(setDpi(600))

      a.undo()
      expect(a.get()).toMatchObject({ title: initial.title, settings: { dpi: 600 } })
      expect(b.get()).toEqual(a.get())
      expect(a.state.getState().canUndo).toBe(false)
      expect(b.state.getState().canUndo).toBe(true)

      b.undo()
      expect(b.get().settings.dpi).toBe(initial.settings.dpi)
      expect(a.get()).toEqual(b.get())

      a.redo()
      expect(b.get()).toMatchObject({ title: 'from a', settings: { dpi: initial.settings.dpi } })
    })

    test('undo does not overwrite a later change by another client to the same field', () => {
      const { a, b } = setup()
      connect(a.doc, b.doc)
      a.applyPatch(setTitle('from a'))
      b.applyPatch(setTitle('from b'))
      a.undo()
      expect(a.get().title).toBe('from b')
      expect(b.get().title).toBe('from b')
    })

    test('edits made while disconnected are merged', () => {
      const { a, b } = setup()
      const addCharacter = (id: string) => [
        { op: 'add' as const, path: '/characters/-', value: { id, name: id, shortName: id } },
      ]
      a.applyPatch(addCharacter('c1'))
      a.applyPatch(setTitle('from a'))
      b.applyPatch(addCharacter('c2'))
      b.applyPatch(setDpi(600))

      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
      Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc))

      expect(
        a
          .get()
          .characters.map((c) => c.id)
          .sort(),
      ).toEqual(['c1', 'c2'])
      expect(a.get()).toMatchObject({ title: 'from a', settings: { dpi: 600 } })
      expect(b.get()).toEqual(a.get())
    })

    test('destroy stops following the doc', () => {
      const { a, b } = setup()
      connect(a.doc, b.doc)
      b.destroy()
      a.applyPatch(setTitle('from a'))
      expect(b.get().title).not.toBe('from a')
      expect(b.doc.getMap(PROJECT_ROOT).get('title')).toBe('from a')
    })
  })
}
