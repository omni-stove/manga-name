import { createEmptyProject, type ID, newId, type Project } from '@manga/schema'
import type { ProjectSummary, StorageAdapter } from '@manga/storage'
import { createProjectStore, type WebProjectStore } from './store/project-store'

/**
 * StorageAdapter の上に、開いているプロジェクトの ProjectStore を 1 プロジェクト 1 つずつ持つ層。
 * ルートの loader と画面はこれを通してプロジェクトを読み書きする。
 */
export interface ProjectLibrary {
  list(): Promise<ProjectSummary[]>
  /** ProjectStore を開く。同じ id には同じ store を返す。保存されていなければ undefined */
  open(id: ID): Promise<WebProjectStore | undefined>
  /** 空のプロジェクトを作って保存する */
  create(title: string): Promise<Project>
  /** 検証済みのプロジェクトを保存する。id が既存と重なるときは新しい id を振る */
  import(project: Project): Promise<Project>
  /** 未保存の変更を書いてから、プロジェクトとアセットを消す */
  remove(id: ID): Promise<void>
  /** 開いている全プロジェクトの未保存の変更を保存する */
  flushAll(): Promise<void>
}

interface ProjectLibraryOptions {
  /** ProjectStore の保存 debounce。既定 500ms */
  debounceMs?: number
  now?: () => string
}

export function createProjectLibrary(
  storage: StorageAdapter,
  options: ProjectLibraryOptions = {},
): ProjectLibrary {
  const { debounceMs, now = () => new Date().toISOString() } = options
  // Promise を持つのは、同じ id を並行して開いたときに store を 2 つ作らないため
  const opened = new Map<ID, Promise<WebProjectStore | undefined>>()

  // file アダプタは読めないファイルを listProjects から外すので、あれば hasProject で確かめる
  const exists = async (id: ID) =>
    storage.hasProject
      ? storage.hasProject(id)
      : (await storage.listProjects()).some((p) => p.id === id)

  const load = async (id: ID) => {
    try {
      const project = await storage.loadProject(id)
      return createProjectStore(project, {
        saveProject: (p) => storage.saveProject(p),
        debounceMs,
        now,
      })
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
      const store = await opened.get(id)?.catch(() => undefined)
      // 先に書き切らないと、debounce 中の保存が削除の後に走ってプロジェクトが復活する
      await store?.flush()
      opened.delete(id)
      await storage.deleteProject(id)
    },
    async flushAll() {
      const stores = await Promise.all([...opened.values()].map((s) => s.catch(() => undefined)))
      await Promise.all(stores.map((s) => s?.flush()))
    },
  }
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { createMemoryStorage } = await import('@manga/storage')
  const { fixtures } = await import('@manga/schema')

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
}
