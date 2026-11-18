import { applyPatchToY, createSyncProvider, openProjectDoc, PROJECT_ROOT } from '@manga/collab'
import { m } from '@manga/i18n'
import { type Episode, type Project, parseProject } from '@manga/schema'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

/** 届いたかを確かめる接続を張り直す回数と間隔 */
const CONFIRM_ATTEMPTS = 10
const CONFIRM_INTERVAL_MS = 500

export interface RoomOptions {
  /** 共同編集の WebSocket URL。接続のたびに呼ぶ（sync-ticket は使い捨てのため） */
  url(): Promise<string>
  /** Y.Doc が空のとき（まだ共同編集で開かれていないとき）の Project。`GET /v1/projects/:id` の本文 */
  initial: Project
  /** 既定は `new WebSocket(url)` */
  createSocket?: (url: string) => WebSocket
  /** 最初の同期を待つ上限。既定 10 秒 */
  timeoutMs?: number
  /** 確かめる接続の間隔。既定 CONFIRM_INTERVAL_MS */
  confirmIntervalMs?: number
}

export interface Room {
  /** 今の Project。Y.Doc が空なら initial */
  project(): Project
  /**
   * episode を末尾に足して updatedAt を進め、別の接続でサーバの Y.Doc に入ったことを確かめてから resolve する。
   * 足した結果が ProjectSchema を通らなければ何も送らずに throw し、確かめられなければ throw する
   */
  appendEpisode(episode: Episode, now?: string): Promise<void>
  close(): void
}

/**
 * プロジェクトの共同編集の部屋（workers/api の ProjectRoom）につないで同期を待つ。
 * アプリは共同編集で開いたプロジェクトを Y.Doc から読み、`PUT /v1/projects/:id` の本文は読まないので、
 * 既にあるプロジェクトへの変更はここから Yjs の更新として送る。CLI は参加者として見せないよう awareness を送らない
 */
export async function openRoom(opts: RoomOptions): Promise<Room> {
  const main = await connect(opts)
  const root = main.doc.getMap<unknown>(PROJECT_ROOT)
  const local = Symbol('cli')
  const project = () => (root.size === 0 ? opts.initial : parseProject(root.toJSON()))

  return {
    project,
    async appendEpisode(episode, now = new Date().toISOString()) {
      const current = project()
      parseProject({ ...current, updatedAt: now, episodes: [...current.episodes, episode] })
      main.doc.transact(() => {
        openProjectDoc(main.doc, opts.initial, { origin: local, writeBackVersion: true })
        applyPatchToY(root, {
          op: 'add',
          path: ['episodes', current.episodes.length],
          value: episode,
        })
        applyPatchToY(root, { op: 'replace', path: ['updatedAt'], value: now })
      }, local)
      for (let i = 0; i < CONFIRM_ATTEMPTS; i++) {
        if (main.closed()) throw new Error(m.cli_room_closed())
        await new Promise((r) => setTimeout(r, opts.confirmIntervalMs ?? CONFIRM_INTERVAL_MS))
        const check = await connect(opts)
        const episodes = check.doc.getMap<unknown>(PROJECT_ROOT).get('episodes')
        const arrived =
          episodes instanceof Y.Array &&
          episodes.toArray().some((e) => e instanceof Y.Map && e.get('id') === episode.id)
        check.close()
        if (arrived) return
      }
      throw new Error(m.cli_room_unconfirmed())
    },
    close: main.close,
  }
}

/** 新しい Y.Doc でつなぎ、最初の同期を待つ。待てなければ throw する */
async function connect(opts: RoomOptions) {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  awareness.setLocalState(null)
  const provider = createSyncProvider({
    url: opts.url,
    doc,
    awareness,
    ...(opts.createSocket && { createSocket: opts.createSocket }),
    onError: () => {},
  })
  const close = () => {
    provider.destroy()
    awareness.destroy()
  }
  if (!(await provider.whenSynced(opts.timeoutMs ?? 10_000))) {
    const closed = provider.state.getState().status === 'closed'
    close()
    throw new Error(closed ? m.cli_room_closed() : m.cli_room_timeout())
  }
  return { doc, close, closed: () => provider.state.getState().status === 'closed' }
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { createFakeSyncServer, writeYMap } = await import('@manga/collab')
  const { createEmptyProject, newId } = await import('@manga/schema')

  const episode = (): Episode => ({ id: newId(), title: '第2話', pages: [] })
  const optionsFor = (server: ReturnType<typeof createFakeSyncServer>, initial: Project) => ({
    url: async () => 'ws://fake',
    initial,
    createSocket: server.createSocket,
    confirmIntervalMs: 0,
  })
  const serverProject = (server: ReturnType<typeof createFakeSyncServer>) =>
    parseProject(server.doc.getMap(PROJECT_ROOT).toJSON())

  describe('openRoom', () => {
    test('appends the episode to the project the server already holds', async () => {
      const server = createFakeSyncServer()
      const held = {
        ...createEmptyProject('held'),
        episodes: [{ id: 'ep1', title: '第1話', pages: [] }],
      }
      writeYMap(server.doc.getMap(PROJECT_ROOT), held as unknown as Record<string, unknown>)
      const room = await openRoom(optionsFor(server, createEmptyProject('stale')))
      expect(room.project().title).toBe('held')

      const added = episode()
      await room.appendEpisode(added, '2026-10-20T00:00:00.000Z')
      room.close()
      const project = serverProject(server)
      expect(project.episodes.map((e) => e.id)).toEqual(['ep1', added.id])
      expect(project.updatedAt).toBe('2026-10-20T00:00:00.000Z')
      expect(server.connections).toBe(0)
    })

    test('writes the initial project first when the server holds none', async () => {
      const server = createFakeSyncServer()
      const initial = createEmptyProject('from json')
      const room = await openRoom(optionsFor(server, initial))
      expect(room.project()).toBe(initial)
      await room.appendEpisode(episode())
      room.close()
      expect(serverProject(server)).toMatchObject({ id: initial.id, title: 'from json' })
      expect(serverProject(server).episodes).toHaveLength(1)
    })

    test('an invalid episode is not sent', async () => {
      const server = createFakeSyncServer()
      const room = await openRoom(optionsFor(server, createEmptyProject('t')))
      await expect(room.appendEpisode({ id: '', title: 1 } as unknown as Episode)).rejects.toThrow()
      room.close()
      expect(server.doc.getMap(PROJECT_ROOT).size).toBe(0)
    })

    test('throws when the first sync does not finish', async () => {
      const server = createFakeSyncServer()
      server.setOnline(false)
      await expect(
        openRoom({ ...optionsFor(server, createEmptyProject('t')), timeoutMs: 20 }),
      ).rejects.toThrow(m.cli_room_timeout())
    })
  })
}
