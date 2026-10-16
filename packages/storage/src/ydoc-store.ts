import type { ID } from '@manga/schema'
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

/**
 * 共同編集の Y.Doc の状態（`Y.encodeStateAsUpdate` の出力）をプロジェクトごとに置く場所。
 * Project JSON から Y.Doc を作り直すと編集履歴が別物になり、オフラインの編集をサーバの状態とマージできないので、
 * 状態そのものをリロードをまたいで残す。
 */
export interface YDocStore {
  /** 保存した状態。無ければ undefined */
  load(projectId: ID): Promise<Uint8Array | undefined>
  /** 状態を丸ごと置き換える */
  save(projectId: ID, state: Uint8Array): Promise<void>
  /** 無いプロジェクトは何もしない */
  delete(projectId: ID): Promise<void>
}

/** メモリだけに持つ YDocStore。リロードで消える */
export function createMemoryYDocStore(): YDocStore {
  const states = new Map<ID, Uint8Array>()
  return {
    async load(projectId) {
      return states.get(projectId)?.slice()
    },
    async save(projectId, state) {
      states.set(projectId, state.slice())
    },
    async delete(projectId) {
      states.delete(projectId)
    },
  }
}

// createIndexedDbStorage の DB とは分ける。同じ DB に足すと既存の DB の版上げが要る
const DB_NAME = 'manga-name-ydoc'
const DB_VERSION = 1

interface YDocDb extends DBSchema {
  states: { key: string; value: Uint8Array }
}

/** IndexedDB に置く YDocStore。DB は最初の操作で開く。`name` を変えると別の DB になる */
export function createIndexedDbYDocStore(name: string = DB_NAME): YDocStore {
  let opening: Promise<IDBPDatabase<YDocDb>> | undefined
  const db = () => {
    opening ??= openDB<YDocDb>(name, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('states')
      },
    }).catch((e) => {
      opening = undefined
      throw e
    })
    return opening
  }
  return {
    async load(projectId) {
      return (await db()).get('states', projectId)
    },
    async save(projectId, state) {
      await (await db()).put('states', state, projectId)
    },
    async delete(projectId) {
      await (await db()).delete('states', projectId)
    },
  }
}

if (import.meta.vitest) {
  // fake-indexeddb の exports は ./auto に types を付けていないので、副作用 import の型解決は諦める
  // @ts-expect-error TS7016
  await import('fake-indexeddb/auto')
  const { describe, expect, test } = import.meta.vitest

  const stores: [string, () => YDocStore][] = [
    ['memory', createMemoryYDocStore],
    ['indexeddb', () => createIndexedDbYDocStore(`test-${crypto.randomUUID()}`)],
  ]

  describe.each(stores)('%s YDocStore', (_name, make) => {
    test('save then load round-trips the bytes, and delete removes them', async () => {
      const s = make()
      expect(await s.load('p')).toBeUndefined()
      await s.save('p', new Uint8Array([1, 2, 3]))
      await s.save('q', new Uint8Array([9]))
      expect([...((await s.load('p')) ?? [])]).toEqual([1, 2, 3])
      await s.save('p', new Uint8Array([4]))
      expect([...((await s.load('p')) ?? [])]).toEqual([4])
      await s.delete('p')
      await s.delete('missing')
      expect(await s.load('p')).toBeUndefined()
      expect([...((await s.load('q')) ?? [])]).toEqual([9])
    })

    test('the saved bytes do not alias the caller buffer', async () => {
      const s = make()
      const state = new Uint8Array([1])
      await s.save('p', state)
      state[0] = 2
      expect([...((await s.load('p')) ?? [])]).toEqual([1])
    })
  })

  test('indexeddb states survive a new store on the same database', async () => {
    const name = `test-${crypto.randomUUID()}`
    await createIndexedDbYDocStore(name).save('p', new Uint8Array([7]))
    expect([...((await createIndexedDbYDocStore(name).load('p')) ?? [])]).toEqual([7])
  })
}
