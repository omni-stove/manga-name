import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import type { Project } from '@manga/schema'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { createApp } from '../src/app'
import { readYDocSnapshot } from '../src/project-store'
import { DEBUG_USER_HEADER } from '../src/projects'
import { CLOSE_PROJECT_DELETED, restoreDoc } from '../src/room'
import { createRoomStorage } from '../src/room-storage'

const app = createApp()

const REMOTE = Symbol('remote')

interface Client {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  closed: Promise<number>
  close(): void
}

const openClients: Client[] = []

function syncPath(id: string) {
  return `/v1/projects/${id}/sync`
}

function upgrade(id: string, user: string | null = 'alice', headers: Record<string, string> = {}) {
  return app.request(
    syncPath(id),
    {
      headers: {
        upgrade: 'websocket',
        ...(user === null ? {} : { [DEBUG_USER_HEADER]: user }),
        ...headers,
      },
    },
    env,
  )
}

/** y-websocket のクライアントと同じ手順で同期する接続を開く */
async function connect(id: string): Promise<Client> {
  const res = await upgrade(id)
  expect(res.status).toBe(101)
  const ws = res.webSocket
  if (!ws) throw new Error('no WebSocket in the response')
  ws.accept()

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  let open = true
  const send = (type: number, write: (e: encoding.Encoder) => void) => {
    if (!open) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, type)
    write(encoder)
    ws.send(encoding.toUint8Array(encoder))
  }

  ws.addEventListener('message', (event) => {
    const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer))
    switch (decoding.readVarUint(decoder)) {
      case 0: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, 0)
        syncProtocol.readSyncMessage(decoder, encoder, doc, REMOTE)
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder))
        break
      }
      case 1:
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          REMOTE,
        )
        break
      case 3:
        send(1, (e) =>
          encoding.writeVarUint8Array(
            e,
            awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]),
          ),
        )
        break
    }
  })
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) send(0, (e) => syncProtocol.writeUpdate(e, update))
  })
  awareness.on('update', (_: unknown, origin: unknown) => {
    if (origin !== REMOTE) {
      send(1, (e) =>
        encoding.writeVarUint8Array(
          e,
          awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]),
        ),
      )
    }
  })
  const closed = new Promise<number>((resolve) =>
    ws.addEventListener('close', (event) => {
      open = false
      resolve(event.code)
    }),
  )
  send(0, (e) => syncProtocol.writeSyncStep1(e, doc))

  const client: Client = {
    doc,
    awareness,
    closed,
    close() {
      if (!open) return
      // 離脱の Awareness を自分では送らずに切る。サーバが代わりに送るかを確かめるため
      open = false
      awareness.destroy()
      ws.close(1000, 'done')
    },
  }
  openClients.push(client)
  return client
}

async function createProject(user = 'alice') {
  const res = await app.request(
    '/v1/projects',
    {
      method: 'POST',
      headers: { [DEBUG_USER_HEADER]: user, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '共同編集' }),
    },
    env,
  )
  expect(res.status).toBe(201)
  return (await res.json()) as Project
}

const room = (id: string) => env.PROJECT_ROOMS.get(env.PROJECT_ROOMS.idFromName(id))

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM project_ydoc_chunks'),
    env.DB.prepare('DELETE FROM project_doc_chunks'),
    env.DB.prepare('DELETE FROM projects'),
    env.DB.prepare('DELETE FROM users'),
  ])
})

afterEach(() => {
  for (const client of openClients.splice(0)) client.close()
})

describe('GET /v1/projects/:id/sync', () => {
  test('401 without X-Debug-User, 404 for a missing or foreign project', async () => {
    const project = await createProject()
    expect((await upgrade(project.id, null)).status).toBe(401)
    expect((await upgrade(project.id, 'bob')).status).toBe(404)
    expect((await upgrade('missing')).status).toBe(404)
  })

  test('426 without a WebSocket upgrade', async () => {
    const project = await createProject()
    const res = await app.request(
      syncPath(project.id),
      { headers: { [DEBUG_USER_HEADER]: 'alice' } },
      env,
    )
    expect(res.status).toBe(426)
  })

  test('updates round-trip between two connections', async () => {
    const project = await createProject()
    const a = await connect(project.id)
    const b = await connect(project.id)

    a.doc.getMap('project').set('title', 'A の題')
    await vi.waitFor(() => expect(b.doc.getMap('project').get('title')).toBe('A の題'))

    b.doc.getArray<string>('pages').push(['B のページ'])
    await vi.waitFor(() => expect(a.doc.getArray('pages').toArray()).toEqual(['B のページ']))
  })

  test('concurrent edits from both connections are merged', async () => {
    const project = await createProject()
    const a = await connect(project.id)
    const b = await connect(project.id)

    a.doc.getMap('balloons').set('a', { x: 0.1 })
    b.doc.getMap('balloons').set('b', { x: 0.9 })
    for (const client of [a, b]) {
      await vi.waitFor(() =>
        expect(client.doc.getMap('balloons').toJSON()).toEqual({ a: { x: 0.1 }, b: { x: 0.9 } }),
      )
    }
  })

  test('a late connection receives the state written before it joined', async () => {
    const project = await createProject()
    const a = await connect(project.id)
    const b = await connect(project.id)
    a.doc.getMap('project').set('title', '先に書いた')
    await vi.waitFor(() => expect(b.doc.getMap('project').get('title')).toBe('先に書いた'))
    a.close()
    b.close()

    const c = await connect(project.id)
    await vi.waitFor(() => expect(c.doc.getMap('project').get('title')).toBe('先に書いた'))
  })

  test('relays awareness and removes it when the connection closes', async () => {
    const project = await createProject()
    const a = await connect(project.id)
    const b = await connect(project.id)

    a.awareness.setLocalState({ selection: 'balloon-1' })
    await vi.waitFor(() =>
      expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ selection: 'balloon-1' }),
    )

    a.close()
    await vi.waitFor(() => expect(b.awareness.getStates().has(a.doc.clientID)).toBe(false))
  })

  test('closes the connection on a text message', async () => {
    const project = await createProject()
    const res = await upgrade(project.id)
    const ws = res.webSocket
    if (!ws) throw new Error('no WebSocket in the response')
    ws.accept()
    const closed = new Promise<number>((resolve) =>
      ws.addEventListener('close', (event) => resolve(event.code)),
    )
    ws.send('hello')
    expect(await closed).toBe(1003)
  })
})

describe('persistence', () => {
  test('restores from DO storage after a restart, compacting many updates', async () => {
    const project = await createProject()
    const a = await connect(project.id)
    const b = await connect(project.id)
    a.doc.getMap('project').set('title', '復元')
    for (let i = 0; i < 600; i++) a.doc.getArray<number>('log').push([i])
    await vi.waitFor(() => expect(b.doc.getArray('log').length).toBe(600))
    a.close()
    b.close()

    await runInDurableObject(room(project.id), async (_instance, state) => {
      // 再起動した DO と同じく、メモリ上の Y.Doc を持たない状態から読み直す
      const doc = new Y.Doc()
      expect(await createRoomStorage(state.storage).load(doc)).toBe(true)
      expect(doc.getMap('project').get('title')).toBe('復元')
      expect(doc.getArray('log').length).toBe(600)
      expect((await state.storage.list({ prefix: 'snapshot:' })).size).toBeGreaterThan(0)
      expect((await state.storage.list({ prefix: 'update:' })).size).toBeLessThan(600)
    })
  })

  test('writes a snapshot to D1 on the alarm and restores from it when DO storage is empty', async () => {
    const project = await createProject()
    const a = await connect(project.id)
    const b = await connect(project.id)
    a.doc.getMap('project').set('title', 'D1 へ')
    await vi.waitFor(() => expect(b.doc.getMap('project').get('title')).toBe('D1 へ'))

    await vi.waitFor(async () => expect(await runDurableObjectAlarm(room(project.id))).toBe(true))
    const saved = await readYDocSnapshot(env.DB, project.id)
    if (!saved) throw new Error('no snapshot in D1')
    const fromD1 = new Y.Doc()
    Y.applyUpdate(fromD1, saved)
    expect(fromD1.getMap('project').get('title')).toBe('D1 へ')

    await runInDurableObject(room(project.id), async (_instance, state) => {
      await state.storage.deleteAll()
      const doc = await restoreDoc(createRoomStorage(state.storage), env.DB, project.id)
      expect(doc.getMap('project').get('title')).toBe('D1 へ')
      expect((await state.storage.list({ prefix: 'snapshot:' })).size).toBeGreaterThan(0)
    })
  })

  test('deleting the project closes connections and clears DO storage and the D1 snapshot', async () => {
    const project = await createProject()
    const a = await connect(project.id)
    const b = await connect(project.id)
    a.doc.getMap('project').set('title', '消える')
    await vi.waitFor(() => expect(b.doc.getMap('project').get('title')).toBe('消える'))
    await vi.waitFor(async () => expect(await runDurableObjectAlarm(room(project.id))).toBe(true))

    const res = await app.request(
      `/v1/projects/${project.id}`,
      { method: 'DELETE', headers: { [DEBUG_USER_HEADER]: 'alice' } },
      env,
    )
    expect(res.status).toBe(204)
    expect(await a.closed).toBe(CLOSE_PROJECT_DELETED)
    expect(await readYDocSnapshot(env.DB, project.id)).toBeNull()
    await runInDurableObject(room(project.id), async (_instance, state) => {
      expect((await state.storage.list()).size).toBe(0)
      expect(await state.storage.getAlarm()).toBeNull()
    })
  })
})
