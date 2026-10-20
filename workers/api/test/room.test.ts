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
import { CLOSE_PROJECT_DELETED, restoreDoc } from '../src/room'
import { createRoomStorage } from '../src/room-storage'
import { SYNC_TICKET_TTL_MS } from '../src/sync-ticket'
import { DEBUG_USER_HEADER } from '../src/user'

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
async function connect(id: string, user = 'alice'): Promise<Client> {
  const res = await upgrade(id, user)
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

async function issueTicket(id: string, user: string | null = 'alice', target = app) {
  return target.request(
    `/v1/projects/${id}/sync-ticket`,
    { method: 'POST', headers: user === null ? {} : { [DEBUG_USER_HEADER]: user } },
    env,
  )
}

async function ticketFor(id: string, user = 'alice', target = app) {
  const res = await issueTicket(id, user, target)
  expect(res.status).toBe(201)
  return ((await res.json()) as { ticket: string }).ticket
}

/** ブラウザの WebSocket と同じく、認証のヘッダを付けずにチケットだけでつなぐ */
function upgradeWithTicket(id: string, ticket: string, target = app) {
  return target.request(
    `${syncPath(id)}?ticket=${encodeURIComponent(ticket)}`,
    { headers: { upgrade: 'websocket' } },
    env,
  )
}

const room = (id: string) => env.PROJECT_ROOMS.get(env.PROJECT_ROOMS.idFromName(id))

async function addMember(projectId: string, userId: string, role: string) {
  await env.DB.prepare(
    'INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?1, ?2, ?3, 0)',
  )
    .bind(projectId, userId, role)
    .run()
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits'),
    env.DB.prepare('DELETE FROM sync_tickets'),
    env.DB.prepare('DELETE FROM project_members'),
    env.DB.prepare('DELETE FROM assets'),
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

describe('sync tickets', () => {
  test('a ticket connects without any auth header', async () => {
    const project = await createProject()
    const res = await upgradeWithTicket(project.id, await ticketFor(project.id))
    expect(res.status).toBe(101)
    res.webSocket?.accept()
    res.webSocket?.close()
  })

  test('a ticket can be used only once', async () => {
    const project = await createProject()
    const ticket = await ticketFor(project.id)
    const first = await upgradeWithTicket(project.id, ticket)
    expect(first.status).toBe(101)
    first.webSocket?.accept()
    first.webSocket?.close()
    expect((await upgradeWithTicket(project.id, ticket)).status).toBe(401)
  })

  test('401 after the ticket expires', async () => {
    let clock = Date.now()
    const timed = createApp({ now: () => clock })
    const project = await createProject()
    const ticket = await ticketFor(project.id, 'alice', timed)
    clock += SYNC_TICKET_TTL_MS
    expect((await upgradeWithTicket(project.id, ticket, timed)).status).toBe(401)
  })

  test('401 for an unknown ticket or one issued for another project', async () => {
    const mine = await createProject()
    const theirs = await createProject('bob')
    expect((await upgradeWithTicket(mine.id, 'unknown')).status).toBe(401)
    expect((await upgradeWithTicket(theirs.id, await ticketFor(mine.id))).status).toBe(401)
  })

  test('issuing needs a user who takes part in the project', async () => {
    const project = await createProject()
    expect((await issueTicket(project.id, null)).status).toBe(401)
    expect((await issueTicket(project.id, 'bob')).status).toBe(404)
    expect((await issueTicket('missing')).status).toBe(404)
  })

  test('the ticket is stored only as a hash', async () => {
    const project = await createProject()
    const ticket = await ticketFor(project.id)
    const rows = await env.DB.prepare('SELECT token_hash FROM sync_tickets').all<{
      token_hash: string
    }>()
    expect(rows.results).toHaveLength(1)
    expect(rows.results[0]?.token_hash).not.toBe(ticket)
  })
})

describe('roles', () => {
  /** apps/web と同じく、ルートの Y.Map `project` に 1 ページを置き、その scribbles を空の Y.Array にする */
  function writePage(doc: Y.Doc) {
    doc.transact(() => {
      const root = doc.getMap<unknown>('project')
      root.set('title', '元の題')
      const page = new Y.Map<unknown>()
      page.set('id', 'pg_1')
      page.set('scribbles', new Y.Array())
      const episode = new Y.Map<unknown>()
      episode.set('pages', Y.Array.from([page]))
      root.set('episodes', Y.Array.from([episode]))
    })
  }

  const scribblesOf = (doc: Y.Doc) => {
    const episodes = doc.getMap('project').get('episodes') as Y.Array<Y.Map<unknown>> | undefined
    const page = (episodes?.get(0)?.get('pages') as Y.Array<Y.Map<unknown>> | undefined)?.get(0)
    return page?.get('scribbles') as Y.Array<string> | undefined
  }

  /** owner の alice が 1 ページを書いたプロジェクトに user を role で参加させ、両方の接続を返す */
  async function joined(role: string) {
    const project = await createProject()
    await addMember(project.id, 'bob', role)
    const owner = await connect(project.id)
    writePage(owner.doc)
    const member = await connect(project.id, 'bob')
    await vi.waitFor(() => expect(scribblesOf(member.doc)).toBeDefined())
    return { project, owner, member }
  }

  /** 新しい接続で、サーバの今の状態を受け取る */
  async function serverState(projectId: string) {
    const fresh = await connect(projectId)
    await vi.waitFor(() => expect(scribblesOf(fresh.doc)).toBeDefined())
    return fresh.doc
  }

  test('a commenter’s scribbles, with the root updatedAt, reach the other connections', async () => {
    const { owner, member } = await joined('commenter')
    member.doc.transact(() => {
      scribblesOf(member.doc)?.push(['stroke'])
      member.doc.getMap('project').set('updatedAt', '2026-10-15T00:00:00.000Z')
    })
    await vi.waitFor(() => expect(scribblesOf(owner.doc)?.toArray()).toEqual(['stroke']))
    expect(owner.doc.getMap('project').get('updatedAt')).toBe('2026-10-15T00:00:00.000Z')
  })

  test('a commenter’s change outside the scribbles closes the connection and is not applied', async () => {
    const { project, member } = await joined('commenter')
    member.doc.getMap('project').set('title', 'commenter の題')
    expect(await member.closed).toBe(4403)
    expect((await serverState(project.id)).getMap('project').get('title')).toBe('元の題')
  })

  test('a viewer receives updates but any change of theirs closes the connection', async () => {
    const { project, owner, member } = await joined('viewer')
    owner.doc.getMap('project').set('title', 'owner の題')
    await vi.waitFor(() => expect(member.doc.getMap('project').get('title')).toBe('owner の題'))

    scribblesOf(member.doc)?.push(['stroke'])
    expect(await member.closed).toBe(4403)
    expect(scribblesOf(await serverState(project.id))?.length).toBe(0)
  })

  test('an editor’s changes reach the other connections', async () => {
    const { owner, member } = await joined('editor')
    member.doc.getMap('project').set('title', 'editor の題')
    await vi.waitFor(() => expect(owner.doc.getMap('project').get('title')).toBe('editor の題'))
  })
})

describe('persistence', () => {
  // 600 回の往復は CI の istanbul 計測下で既定の 5 秒を超えることがある。waitFor より長くして、待ちの失敗を waitFor の側で報告させる
  test('restores from DO storage after a restart, compacting many updates', async () => {
    const project = await createProject()
    const a = await connect(project.id)
    const b = await connect(project.id)
    a.doc.getMap('project').set('title', '復元')
    for (let i = 0; i < 600; i++) a.doc.getArray<number>('log').push([i])
    await vi.waitFor(() => expect(b.doc.getArray('log').length).toBe(600), { timeout: 15_000 })
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
  }, 20_000)

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
