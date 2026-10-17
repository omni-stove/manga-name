import { createEmptyProject, type ID, newId, type Project } from '@manga/schema'
import type { ProjectSummary, StorageAdapter, YDocStore } from '@manga/storage'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { StoreApi } from 'zustand/vanilla'
import type { ProjectRole } from './sharing'
import { createPresence, type Presence } from './store/presence'
import { createProjectStore, type ProjectStore, type WebProjectStore } from './store/project-store'
import { restrictStore } from './store/restricted-store'
import { createSyncProvider, type SyncProviderState } from './store/sync-provider'
import { createYjsProjectStore } from './store/yjs-project-store'

/**
 * StorageAdapter の上に、開いているプロジェクトの ProjectStore を 1 プロジェクト 1 つずつ持つ層。
 * ルートの loader と画面はこれを通してプロジェクトを読み書きする。
 */
export interface ProjectLibrary {
  list(): Promise<ProjectSummary[]>
  /** ProjectStore を開く。同じ id には同じ store を返す。保存されていなければ undefined */
  open(id: ID): Promise<WebProjectStore | undefined>
  /** open 済みのプロジェクトでの自分のロール。open していなければ undefined */
  role(id: ID): ProjectRole | undefined
  /** open 済みのプロジェクトの共同編集の接続と presence。共同編集で開いていなければ undefined */
  collaboration(id: ID): Collaboration | undefined
  /** 空のプロジェクトを作って保存する */
  create(title: string): Promise<Project>
  /** store が今もその id で開かれているか。remove 済みなら false。長く待つ処理が削除後の書き戻しを避けるのに使う */
  isOpen(id: ID, store: ProjectStore): Promise<boolean>
  /** 検証済みのプロジェクトを保存する。id が既存と重なるときは新しい id を振る */
  import(project: Project): Promise<Project>
  /** 未保存の変更を書いてから、プロジェクトとアセットを消す */
  remove(id: ID): Promise<void>
  /** 開いている全プロジェクトの未保存の変更を保存する */
  flushAll(): Promise<void>
  /** PanelArt.ref を表示用 URL にする。呼び出し側が URL.revokeObjectURL で解放する。無ければ throw */
  resolveAsset(ref: string): Promise<string>
  /** ref の画像を Blob で返す。生成の参照画像と前回の絵に使う。無ければ throw */
  loadAsset(ref: string): Promise<Blob>
  /** 画像を保存して ref を返す */
  putAsset(projectId: ID, blob: Blob, hint?: string): Promise<string>
}

/** 共同編集で開いたプロジェクトの、同期サーバとの接続と他のクライアント */
export interface Collaboration {
  readonly sync: StoreApi<SyncProviderState>
  readonly presence: Presence
}

interface CollaborationOptions {
  /** プロジェクトの同期サーバの WebSocket URL。接続のたびに呼ぶ。まだつなげなければ null（CloudStorage.syncUrl） */
  syncUrl(id: ID): Promise<string | null>
  /** Y.Doc の状態を置く場所 */
  ydocs: YDocStore
  /** 他のクライアントに見せる名前 */
  userName: string
  createSocket?: (url: string) => WebSocket
  /**
   * 手元に Y.Doc の状態が無いとき、サーバの状態を待つ上限。既定 5 秒。
   * 待たずに手元の Project から Y.Doc を作ると、サーバに既にある Y.Doc とキーごとに混ざってしまう
   */
  firstSyncTimeoutMs?: number
  /** 同期プロバイダの再接続の最初の待ち時間 */
  minReconnectMs?: number
}

interface ProjectLibraryOptions {
  /** ProjectStore と Y.Doc の保存 debounce。既定 500ms */
  debounceMs?: number
  now?: () => string
  /** 指定すると、プロジェクトを Yjs の ProjectStore で開き、同期サーバにつなぐ */
  collaboration?: CollaborationOptions
  /** プロジェクトでの自分のロール。open した store の変更をロールで制限する。既定は常に owner */
  roleOf?: (id: ID) => Promise<ProjectRole>
}

interface Session extends Collaboration {
  /** Y.Doc の状態を書く */
  flush(): Promise<void>
  close(): void
}

/** `doc` の変更を debounce して `ydocs` に書く */
function persistDoc(doc: Y.Doc, ydocs: YDocStore, id: ID, debounceMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  let queue: Promise<void> = Promise.resolve()
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (!dirty) return queue
    dirty = false
    // 前の書き込みを待つのは、古い状態の書き込みが後から終わって新しい状態を上書きしないため
    queue = queue
      .then(() => ydocs.save(id, Y.encodeStateAsUpdate(doc)))
      .catch((e) => {
        dirty = true
        console.warn('failed to save the Y.Doc', id, e)
      })
    return queue
  }
  const onUpdate = () => {
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), debounceMs)
  }
  doc.on('update', onUpdate)
  return {
    flush,
    dispose() {
      clearTimeout(timer)
      doc.off('update', onUpdate)
    },
  }
}

export function createProjectLibrary(
  storage: StorageAdapter,
  options: ProjectLibraryOptions = {},
): ProjectLibrary {
  const { debounceMs, now = () => new Date().toISOString(), collaboration, roleOf } = options
  // Promise を持つのは、同じ id を並行して開いたときに store を 2 つ作らないため
  const opened = new Map<ID, Promise<WebProjectStore | undefined>>()
  const sessions = new Map<ID, Session>()
  const roles = new Map<ID, ProjectRole>()

  const openCollaborative = async (
    id: ID,
    project: Project,
    collab: CollaborationOptions,
  ): Promise<WebProjectStore> => {
    const doc = new Y.Doc()
    const saved = await collab.ydocs.load(id)
    if (saved) Y.applyUpdate(doc, saved)
    const awareness = new Awareness(doc)
    const presence = createPresence(awareness, { name: collab.userName })
    const provider = createSyncProvider({
      url: () => collab.syncUrl(id),
      doc,
      awareness,
      createSocket: collab.createSocket,
      minReconnectMs: collab.minReconnectMs,
    })
    const persisted = persistDoc(doc, collab.ydocs, id, debounceMs ?? 500)
    try {
      if (!saved) {
        // 接続先が無い・オフラインのときはサーバに混ぜる相手の Y.Doc が無いので、タイムアウトまで待たない
        let stopWaiting = () => {}
        const offline = new Promise<void>((resolve) => {
          const isOffline = (s: { status: string }) => s.status === 'offline'
          if (isOffline(provider.state.getState())) return resolve()
          stopWaiting = provider.state.subscribe((s) => isOffline(s) && resolve())
        })
        await Promise.race([provider.whenSynced(collab.firstSyncTimeoutMs ?? 5000), offline])
        stopWaiting()
      }
      const store = createYjsProjectStore(project, {
        doc,
        // サーバの Y.Doc を作ったクライアントの id が入っていることがあるので、手元の id で保存する
        saveProject: (p) => storage.saveProject(p.id === id ? p : { ...p, id }),
        debounceMs,
        now,
      })
      sessions.set(id, {
        sync: provider.state,
        presence,
        flush: persisted.flush,
        close() {
          provider.destroy()
          presence.destroy()
          store.destroy()
          persisted.dispose()
          awareness.destroy()
        },
      })
      return store
    } catch (error) {
      provider.destroy()
      presence.destroy()
      persisted.dispose()
      awareness.destroy()
      throw error
    }
  }

  // file アダプタは読めないファイルを listProjects から外すので、あれば hasProject で確かめる
  const exists = async (id: ID) =>
    storage.hasProject
      ? storage.hasProject(id)
      : (await storage.listProjects()).some((p) => p.id === id)

  const load = async (id: ID) => {
    try {
      const project = await storage.loadProject(id)
      // 読み込みの後に引くのは、クラウドにしか無いプロジェクトはクラウドの id との対応が読み込みで作られるため
      const role = (await roleOf?.(id)) ?? 'owner'
      roles.set(id, role)
      if (collaboration) {
        return restrictStore(await openCollaborative(id, project, collaboration), role)
      }
      const store = createProjectStore(project, {
        saveProject: (p) => storage.saveProject(p),
        debounceMs,
        now,
      })
      return restrictStore(store, role)
    } catch (error) {
      // loadProject は「無い」と「壊れている」を同じく throw するので、無いときだけ undefined にする
      if (!(await exists(id))) return undefined
      throw error
    }
  }

  return {
    list: () => storage.listProjects(),
    open(id) {
      let store = opened.get(id)
      if (!store) {
        store = load(id)
        opened.set(id, store)
        // 無い・読めないを覚えておくと、後から作られたり直ったりしても開けないままになる
        store.then(
          (s) => {
            if (!s) opened.delete(id)
          },
          () => opened.delete(id),
        )
      }
      return store
    },
    role: (id) => roles.get(id),
    collaboration: (id) => sessions.get(id),
    async isOpen(id, store) {
      return (await opened.get(id)?.catch(() => undefined)) === store
    },
    async create(title) {
      const project = createEmptyProject(title)
      await storage.saveProject(project)
      return project
    },
    async import(project) {
      const imported = {
        ...project,
        id:
          (storage.canStoreId?.(project.id) ?? true) && !(await exists(project.id))
            ? project.id
            : newId(),
        updatedAt: now(),
      }
      await storage.saveProject(imported)
      return imported
    },
    async remove(id) {
      const pending = opened.get(id)
      // flush を待つ間に isOpen が true を返すと、生成の書き込みが flush の後に保存されて復活する
      opened.delete(id)
      // open の完了を待ってから読まないと、最初の同期の途中で消したときに session が登録されたまま残る
      const store = await pending?.catch(() => undefined)
      const session = sessions.get(id)
      sessions.delete(id)
      // 先に切らないと、flush を待つ間に届いた他のクライアントの更新が新しい debounce を張り、削除の後に保存が走ってプロジェクトが復活する
      session?.close()
      // 先に書き切らないと、debounce 中の保存が削除の後に走ってプロジェクトが復活する
      await store?.flush()
      await session?.flush()
      await storage.deleteProject(id)
      await collaboration?.ydocs.delete(id)
      roles.delete(id)
      // 待つ間に open(id) が呼ばれると、まだ消えていないプロジェクトの store が opened に入る
      opened.delete(id)
    },
    async flushAll() {
      const stores = await Promise.all([...opened.values()].map((s) => s.catch(() => undefined)))
      await Promise.all([
        ...stores.map((s) => s?.flush()),
        ...[...sessions.values()].map((s) => s.flush()),
      ])
    },
    resolveAsset: (ref) => storage.resolveAsset(ref),
    loadAsset: (ref) => storage.loadAsset(ref),
    putAsset: (projectId, blob, hint) => storage.putAsset(projectId, blob, hint),
  }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest
  const { createMemoryStorage, createMemoryYDocStore } = await import('@manga/storage')
  const { currentArt, fixtures } = await import('@manga/schema')
  const { createFakeSyncServer } = await import('./store/fake-sync-server')

  const NOW = '2026-10-15T00:00:00.000Z'
  const setup = () => {
    const storage = createMemoryStorage()
    return { storage, library: createProjectLibrary(storage, { debounceMs: 10, now: () => NOW }) }
  }

  test('create saves an empty project that appears in list', async () => {
    const { library } = setup()
    const project = await library.create('新作')
    expect(await library.list()).toEqual([
      { id: project.id, title: '新作', updatedAt: project.updatedAt },
    ])
  })

  describe('open', () => {
    test('returns the same store for the same id', async () => {
      const { library } = setup()
      const { id } = await library.create('a')
      const [a, b] = await Promise.all([library.open(id), library.open(id)])
      expect(a).toBeDefined()
      expect(a).toBe(b)
      expect(await library.open(id)).toBe(a)
    })

    test('returns undefined for a missing project, and opens it once it exists', async () => {
      const { library, storage } = setup()
      expect(await library.open(fixtures.samplePage01.id)).toBeUndefined()
      await storage.saveProject(fixtures.samplePage01)
      expect((await library.open(fixtures.samplePage01.id))?.get().title).toBe(
        fixtures.samplePage01.title,
      )
    })

    test('rethrows when a stored project cannot be read', async () => {
      const { library, storage } = setup()
      const { id } = await library.create('a')
      const error = new Error('broken')
      vi.spyOn(storage, 'loadProject').mockRejectedValueOnce(error)
      await expect(library.open(id)).rejects.toBe(error)
      expect(await library.open(id)).toBeDefined()
    })

    test('changes are saved through the storage', async () => {
      const { library, storage } = setup()
      const { id } = await library.create('a')
      const store = await library.open(id)
      store?.applyPatch([{ op: 'replace', path: '/title', value: 'b' }])
      await library.flushAll()
      expect((await storage.loadProject(id)).title).toBe('b')
    })
  })

  describe('import', () => {
    test('keeps the id when it is free', async () => {
      const { library, storage } = setup()
      const imported = await library.import(fixtures.samplePage01)
      expect(imported).toEqual({ ...fixtures.samplePage01, updatedAt: NOW })
      expect(await storage.loadProject(imported.id)).toEqual(imported)
    })

    test('assigns a new id when the id is taken', async () => {
      const { library } = setup()
      const first = await library.import(fixtures.samplePage01)
      const second = await library.import(fixtures.samplePage01)
      expect(second.id).not.toBe(first.id)
      expect((await library.list()).map((p) => p.id).sort()).toEqual([first.id, second.id].sort())
    })
  })

  test('remove writes pending changes first and leaves nothing behind', async () => {
    const { library, storage } = setup()
    const { id } = await library.create('a')
    const store = await library.open(id)
    store?.applyPatch([{ op: 'replace', path: '/title', value: 'b' }])
    const save = vi.spyOn(storage, 'saveProject')
    await library.remove(id)
    expect(save).toHaveBeenCalledOnce()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await library.list()).toEqual([])
    expect(await library.open(id)).toBeUndefined()
  })

  describe('collaboration', () => {
    const project = fixtures.samplePage01
    const panelId = project.episodes[0]?.pages[0]?.panels[0]?.id ?? ''
    const pageId = project.episodes[0]?.pages[0]?.id ?? ''
    const cleanups: (() => Promise<void>)[] = []

    /** 1 台のブラウザ。`local` を省くと、同じ Project だけをローカルに持つ新しいブラウザ */
    const createDevice = async (
      server: ReturnType<typeof createFakeSyncServer>,
      name: string,
      saved?: { storage: StorageAdapter; ydocs: YDocStore },
    ) => {
      const local = saved ?? { storage: createMemoryStorage(), ydocs: createMemoryYDocStore() }
      if (!saved) await local.storage.saveProject(project)
      const library = createProjectLibrary(local.storage, {
        debounceMs: 10,
        now: () => NOW,
        collaboration: {
          syncUrl: async () => 'wss://sync.test/v1/projects/p/sync',
          ydocs: local.ydocs,
          userName: name,
          createSocket: (url) => server.createSocket(url),
          minReconnectMs: 5,
          firstSyncTimeoutMs: 1000,
        },
      })
      const store = await library.open(project.id)
      const collab = library.collaboration(project.id)
      if (!store || !collab) throw new Error('not opened collaboratively')
      cleanups.push(() => library.remove(project.id))
      return { ...local, library, store, collab }
    }

    const connected = (d: { collab: Collaboration }) =>
      vi.waitFor(() => expect(d.collab.sync.getState()).toMatchObject({ synced: true }))

    const setTitle = (title: string) => [{ op: 'replace' as const, path: '/title', value: title }]
    const setDpi = (dpi: number) => [{ op: 'replace' as const, path: '/settings/dpi', value: dpi }]

    afterEach(async () => {
      for (const cleanup of cleanups.splice(0)) await cleanup()
    })

    test('a change on one client reaches the other', async () => {
      const server = createFakeSyncServer()
      const a = await createDevice(server, 'a')
      const b = await createDevice(server, 'b')
      await connected(a)
      await connected(b)
      a.store.applyPatch(setTitle('from a'))
      await vi.waitFor(() => expect(b.store.get().title).toBe('from a'))
    })

    test('a client without a saved Y.Doc takes the state on the server', async () => {
      const server = createFakeSyncServer()
      const a = await createDevice(server, 'a')
      await connected(a)
      a.store.applyPatch(setTitle('from a'))
      await vi.waitFor(() => expect(server.doc.getMap('project').get('title')).toBe('from a'))
      const b = await createDevice(server, 'b')
      expect(b.store.get()).toEqual(a.store.get())
    })

    test('the selection of another client is visible with its colour', async () => {
      const server = createFakeSyncServer()
      const a = await createDevice(server, 'a')
      const b = await createDevice(server, 'b')
      await connected(a)
      await connected(b)
      a.collab.presence.setLocation({ pageId, selection: [panelId] })
      await vi.waitFor(() =>
        expect(b.collab.presence.peers.getState()).toEqual([
          expect.objectContaining({
            name: 'a',
            color: a.collab.presence.color,
            pageId,
            selection: [panelId],
          }),
        ]),
      )
    })

    test('the other client disappears when it disconnects', async () => {
      const server = createFakeSyncServer()
      const a = await createDevice(server, 'a')
      const b = await createDevice(server, 'b')
      await connected(a)
      await connected(b)
      await vi.waitFor(() => expect(b.collab.presence.peers.getState()).toHaveLength(1))
      await a.library.remove(project.id)
      await vi.waitFor(() => expect(b.collab.presence.peers.getState()).toEqual([]))
    })

    test('edits made offline on both clients are merged after reconnecting', async () => {
      const server = createFakeSyncServer()
      const a = await createDevice(server, 'a')
      const b = await createDevice(server, 'b')
      await connected(a)
      await connected(b)

      server.setOnline(false)
      server.disconnectAll()
      await vi.waitFor(() => expect(a.collab.sync.getState().status).not.toBe('connected'))
      a.store.applyPatch(setTitle('offline a'))
      b.store.applyPatch(setDpi(600))
      expect(b.store.get().title).not.toBe('offline a')

      server.setOnline(true)
      await vi.waitFor(() => {
        expect(a.store.get()).toMatchObject({ title: 'offline a', settings: { dpi: 600 } })
        expect(b.store.get()).toEqual(a.store.get())
      })
    })

    test('offline edits survive a reload and are merged once connected', async () => {
      const server = createFakeSyncServer()
      const a = await createDevice(server, 'a')
      const b = await createDevice(server, 'b')
      await connected(a)
      await connected(b)

      server.setOnline(false)
      server.disconnectAll()
      a.store.applyPatch(setTitle('offline a'))
      await a.library.flushAll()
      b.store.applyPatch(setDpi(600))

      const local = { storage: createMemoryStorage(), ydocs: createMemoryYDocStore() }
      await local.storage.saveProject(await a.storage.loadProject(project.id))
      const saved = await a.ydocs.load(project.id)
      if (!saved) throw new Error('the Y.Doc was not saved')
      await local.ydocs.save(project.id, saved)
      await a.library.remove(project.id)
      const reopened = await createDevice(server, 'a', local)
      expect(reopened.store.get().title).toBe('offline a')

      server.setOnline(true)
      await vi.waitFor(() => {
        expect(reopened.store.get()).toMatchObject({ title: 'offline a', settings: { dpi: 600 } })
        expect(b.store.get()).toEqual(reopened.store.get())
      })
    })

    test('a generated image reaches the other client as the current art', async () => {
      const server = createFakeSyncServer()
      const a = await createDevice(server, 'a')
      const b = await createDevice(server, 'b')
      await connected(a)
      await connected(b)
      const panelPath = '/episodes/0/pages/0/panels/0'
      const art = {
        id: 'art-1',
        ref: 'r2:cloud/asset-1',
        provider: 'fake',
        prompt: 'p',
        createdAt: NOW,
      }
      a.store.applyPatch([
        { op: 'add', path: `${panelPath}/arts/-`, value: art },
        { op: 'add', path: `${panelPath}/artId`, value: art.id },
      ])
      await vi.waitFor(() => {
        const panel = b.store.get().episodes[0]?.pages[0]?.panels[0]
        expect(panel && currentArt(panel)).toEqual(art)
      })
    })

    test('changes from other clients are saved locally under the local id', async () => {
      const server = createFakeSyncServer()
      const a = await createDevice(server, 'a')
      const b = await createDevice(server, 'b')
      await connected(a)
      await connected(b)
      a.store.applyPatch(setTitle('from a'))
      await vi.waitFor(() => expect(b.store.get().title).toBe('from a'))
      await b.library.flushAll()
      expect((await b.storage.loadProject(project.id)).title).toBe('from a')
      expect(await b.ydocs.load(project.id)).toBeDefined()
    })

    test('remove closes the connection and forgets the Y.Doc', async () => {
      const server = createFakeSyncServer()
      const a = await createDevice(server, 'a')
      await connected(a)
      await a.library.flushAll()
      expect(await a.ydocs.load(project.id)).toBeDefined()
      await a.library.remove(project.id)
      expect(a.collab.sync.getState().status).toBe('closed')
      expect(a.library.collaboration(project.id)).toBeUndefined()
      expect(await a.ydocs.load(project.id)).toBeUndefined()
      await vi.waitFor(() => expect(server.connections).toBe(0))
    })
  })
}
