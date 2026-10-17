import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { createRoomStorage, type RoomStorage } from '../src/room-storage'

/** name の ProjectRoom の DO storage を使って run を呼ぶ。接続しないので ProjectRoom 自身は storage に触れない */
function withStorage(name: string, run: (storage: DurableObjectStorage) => Promise<void>) {
  const stub = env.PROJECT_ROOMS.get(env.PROJECT_ROOMS.idFromName(name))
  return runInDurableObject(stub, (_instance, state) => run(state.storage))
}

/** doc の更新を storage に append していく。RoomStorage の呼び出し元（ProjectRoom）と同じつなぎ方 */
function attach(doc: Y.Doc, storage: RoomStorage) {
  doc.on('update', (update: Uint8Array) => storage.append(doc, update))
}

const keys = async (storage: DurableObjectStorage, prefix: string) => [
  ...(await storage.list({ prefix })).keys(),
]

async function reload(storage: DurableObjectStorage) {
  const doc = new Y.Doc()
  const room = createRoomStorage(storage)
  const found = await room.load(doc)
  return { doc, room, found }
}

describe('createRoomStorage', () => {
  test('load is false on empty storage', async () => {
    await withStorage('empty', async (storage) => {
      const { doc, found } = await reload(storage)
      expect(found).toBe(false)
      expect(doc.share.size).toBe(0)
    })
  })

  test('appended updates load back, and appends after a load continue the sequence', async () => {
    await withStorage('sequence', async (storage) => {
      const first = await reload(storage)
      attach(first.doc, first.room)
      first.doc.getArray<number>('log').push([1])
      first.doc.getArray<number>('log').push([2])
      expect(await keys(storage, 'update:')).toEqual(['update:0000000000', 'update:0000000001'])

      const second = await reload(storage)
      expect(second.found).toBe(true)
      expect(second.doc.getArray('log').toArray()).toEqual([1, 2])
      attach(second.doc, second.room)
      second.doc.getArray<number>('log').push([3])
      expect(await keys(storage, 'update:')).toEqual([
        'update:0000000000',
        'update:0000000001',
        'update:0000000002',
      ])
      expect((await reload(storage)).doc.getArray('log').toArray()).toEqual([1, 2, 3])
    })
  })

  test('an update over 64KiB is compacted into a snapshot split across keys', async () => {
    await withStorage('large-update', async (storage) => {
      const { doc, room } = await reload(storage)
      attach(doc, room)
      doc.getArray<number>('log').push([1])
      doc.getText('body').insert(0, 'x'.repeat(200_000))
      expect(await keys(storage, 'update:')).toEqual([])
      expect(await keys(storage, 'snapshot:')).toEqual([
        'snapshot:000000',
        'snapshot:000001',
        'snapshot:000002',
        'snapshot:000003',
      ])

      const loaded = await reload(storage)
      expect(loaded.found).toBe(true)
      expect(loaded.doc.getText('body').length).toBe(200_000)
      expect(loaded.doc.getArray('log').toArray()).toEqual([1])
    })
  })

  test('compacts once the pending updates pass 1MiB', async () => {
    await withStorage('many-bytes', async (storage) => {
      const { doc, room } = await reload(storage)
      attach(doc, room)
      for (let i = 0; i < 20; i++) doc.getArray<string>('log').push(['y'.repeat(60_000)])
      expect((await keys(storage, 'update:')).length).toBeLessThan(20)
      expect((await keys(storage, 'snapshot:')).length).toBeGreaterThan(0)
      expect((await reload(storage)).doc.getArray('log').length).toBe(20)
    })
  })

  test('a smaller snapshot removes the chunks the larger one left', async () => {
    await withStorage('shrink', async (storage) => {
      const { doc, room } = await reload(storage)
      doc.getText('body').insert(0, 'x'.repeat(200_000))
      room.compact(doc)
      expect((await keys(storage, 'snapshot:')).length).toBe(4)

      doc.getText('body').delete(0, 200_000)
      doc.getText('body').insert(0, 'short')
      room.compact(doc)
      expect(await keys(storage, 'snapshot:')).toEqual(['snapshot:000000'])
      expect((await reload(storage)).doc.getText('body').toString()).toBe('short')
    })
  })

  test('compact replaces the pending updates with one snapshot', async () => {
    await withStorage('compact', async (storage) => {
      const { doc, room } = await reload(storage)
      attach(doc, room)
      doc.getArray<number>('log').push([1])
      doc.getArray<number>('log').push([2])
      room.compact(doc)
      expect(await keys(storage, 'update:')).toEqual([])
      expect(await keys(storage, 'snapshot:')).toEqual(['snapshot:000000'])
      expect((await reload(storage)).doc.getArray('log').toArray()).toEqual([1, 2])
    })
  })

  test('clear removes everything and restarts the sequence', async () => {
    await withStorage('clear', async (storage) => {
      const { doc, room } = await reload(storage)
      attach(doc, room)
      doc.getArray<number>('log').push([1])
      room.compact(doc)
      doc.getArray<number>('log').push([2])
      await room.clear()
      expect((await storage.list()).size).toBe(0)
      expect((await reload(storage)).found).toBe(false)

      doc.getArray<number>('log').push([3])
      expect(await keys(storage, 'update:')).toEqual(['update:0000000000'])
    })
  })
})
