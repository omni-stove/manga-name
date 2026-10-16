import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import type * as Y from 'yjs'
import { createStore, type StoreApi } from 'zustand/vanilla'

/** y-websocket のメッセージ種別。workers/api の ProjectRoom と揃える */
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_QUERY_AWARENESS = 3

/** プロジェクトが削除されてサーバが接続を閉じたときのコード。workers/api の CLOSE_PROJECT_DELETED */
const CLOSE_PROJECT_DELETED = 4404
/** ロールで許されない変更を送って閉じられたときのコード。workers/api の CLOSE_FORBIDDEN。つなぎ直しても同じ変更を送るだけになる */
const CLOSE_FORBIDDEN = 4403

const OPEN = 1

/**
 * - `connecting`: 接続を試みている。失敗すると間をおいて再試行する
 * - `connected`: つながっている。`synced` になるまではサーバの状態を受け取っている途中
 * - `offline`: ブラウザがオフラインか、接続先がまだ無い。復帰したらつなぎ直す
 * - `closed`: プロジェクトが削除されたか、ロールで許されない変更を送ったか、destroy した。以降つながない
 */
export type SyncStatus = 'connecting' | 'connected' | 'offline' | 'closed'

export interface SyncProviderState {
  status: SyncStatus
  /** 今の接続でサーバの状態を受け取り終えたら true。切れると false に戻る */
  synced: boolean
}

interface SyncProviderOptions {
  /**
   * 接続先の WebSocket URL。接続のたびに呼ぶ。null はまだつなげない（クラウドに無い、未ログイン）ことを表し、間をおいて聞き直す
   */
  url(): Promise<string | null>
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  /** 既定は `new WebSocket(url)` */
  createSocket?: (url: string) => WebSocket
  /** 再接続の最初の待ち時間。失敗のたびに倍にする。既定 1 秒 */
  minReconnectMs?: number
  /** 再接続の待ち時間の上限。既定 30 秒 */
  maxReconnectMs?: number
  /** 受け取ったメッセージを適用できなかったときに呼ぶ。既定は console.warn */
  onError?: (error: unknown) => void
}

interface SyncProvider {
  readonly state: StoreApi<SyncProviderState>
  /** サーバの状態を受け取り終えるか、`timeoutMs` が過ぎるか、closed になると resolve する。受け取れたら true */
  whenSynced(timeoutMs: number): Promise<boolean>
  /** 自分の presence を消して切断する。以降つながない */
  destroy(): void
}

function message(type: number, write: (encoder: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/**
 * `doc` と `awareness` を y-websocket と同じプロトコルで同期サーバ（workers/api の ProjectRoom）につなぐ。
 *
 * - つながると SyncStep1 を送り、差分を交換する。切れていた間の `doc` の変更はここで送られ、サーバの変更と Yjs がマージする。
 * - 以降の `doc` の変更と、自分の awareness の変更を送る。他のクライアントの awareness は受け取って `awareness` に入れる。
 * - 切れたら他のクライアントの awareness を消し、指数バックオフで再接続する。オフラインの間は待ち、online イベントでつなぎ直す。
 * - サーバが CLOSE_PROJECT_DELETED で閉じたら再接続しない。
 */
export function createSyncProvider(options: SyncProviderOptions): SyncProvider {
  const {
    doc,
    awareness,
    createSocket = (url: string) => new WebSocket(url),
    minReconnectMs = 1000,
    maxReconnectMs = 30_000,
    onError = (e: unknown) => console.warn('sync failed', e),
  } = options

  const state = createStore<SyncProviderState>()(() => ({ status: 'connecting', synced: false }))
  // サーバから届いた変更をこの origin で適用し、送り返さない
  const origin = Symbol('sync-provider')
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let destroyed = false
  // URL を待つ間に online イベントなどで connect がもう一度呼ばれても、接続を 2 本作らない
  let resolvingUrl = false

  const send = (data: Uint8Array) => {
    if (socket?.readyState === OPEN) socket.send(data as Uint8Array<ArrayBuffer>)
  }

  const ownAwareness = () =>
    message(MESSAGE_AWARENESS, (e) =>
      encoding.writeVarUint8Array(
        e,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]),
      ),
    )

  const onDocUpdate = (update: Uint8Array, from: unknown) => {
    if (from !== origin) send(message(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, update)))
  }

  // 他のクライアントの状態はそれぞれが送るので、自分の分だけ送る。中継すると時間切れで消した相手を復活させてしまう
  const onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    from: unknown,
  ) => {
    // 離脱した相手の clock を残すと、再接続した相手が送る同じ clock の状態を applyAwarenessUpdate が無視する
    for (const id of removed) if (id !== awareness.clientID) awareness.meta.delete(id)
    if (from === origin) return
    if ([...added, ...updated, ...removed].includes(awareness.clientID)) send(ownAwareness())
  }

  const receive = (data: Uint8Array) => {
    const decoder = decoding.createDecoder(data)
    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        const type = syncProtocol.readSyncMessage(decoder, encoder, doc, origin)
        if (encoding.length(encoder) > 1) send(encoding.toUint8Array(encoder))
        if (type === syncProtocol.messageYjsSyncStep2 && !state.getState().synced) {
          state.setState({ synced: true })
        }
        break
      }
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          origin,
        )
        break
      case MESSAGE_QUERY_AWARENESS:
        if (awareness.getLocalState() !== null) send(ownAwareness())
        break
    }
  }

  const forgetPeers = () => {
    const peers = [...awareness.getStates().keys()].filter((id) => id !== awareness.clientID)
    if (peers.length > 0) awarenessProtocol.removeAwarenessStates(awareness, peers, origin)
  }

  const retry = () => {
    if (destroyed) return
    failures++
    clearTimeout(timer)
    timer = setTimeout(
      () => void connect(),
      Math.min(minReconnectMs * 2 ** (failures - 1), maxReconnectMs),
    )
  }

  async function connect() {
    timer = undefined
    if (destroyed || socket || resolvingUrl) return
    if (isOffline()) {
      state.setState({ status: 'offline', synced: false })
      return
    }
    state.setState({ status: 'connecting', synced: false })
    let url: string | null
    resolvingUrl = true
    try {
      url = await options.url()
    } catch (e) {
      onError(e)
      retry()
      return
    } finally {
      resolvingUrl = false
    }
    if (destroyed || socket) return
    if (url === null) {
      state.setState({ status: 'offline' })
      retry()
      return
    }

    const ws = createSocket(url)
    ws.binaryType = 'arraybuffer'
    socket = ws
    ws.onopen = () => {
      if (socket !== ws) return
      failures = 0
      state.setState({ status: 'connected', synced: false })
      send(message(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, doc)))
      if (awareness.getLocalState() !== null) send(ownAwareness())
    }
    ws.onmessage = (event: MessageEvent) => {
      if (socket !== ws || !(event.data instanceof ArrayBuffer)) return
      try {
        receive(new Uint8Array(event.data))
      } catch (e) {
        onError(e)
      }
    }
    ws.onclose = (event: CloseEvent) => {
      if (socket !== ws) return
      socket = undefined
      forgetPeers()
      if (event.code === CLOSE_PROJECT_DELETED || event.code === CLOSE_FORBIDDEN) {
        destroyed = true
        state.setState({ status: 'closed', synced: false })
        return
      }
      state.setState({ status: isOffline() ? 'offline' : 'connecting', synced: false })
      retry()
    }
  }

  const onOnline = () => {
    if (destroyed || socket) return
    clearTimeout(timer)
    failures = 0
    void connect()
  }
  // 切れた回線の WebSocket は close が届くまで長くかかるので、オフラインになった時点で閉じる
  const onOffline = () => socket?.close()

  doc.on('update', onDocUpdate)
  awareness.on('update', onAwarenessUpdate)
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
  }
  void connect()

  return {
    state,
    whenSynced(timeoutMs) {
      const done = (s: SyncProviderState) => s.synced || s.status === 'closed'
      if (done(state.getState())) return Promise.resolve(state.getState().synced)
      return new Promise((resolve) => {
        const finish = (synced: boolean) => {
          clearTimeout(timeout)
          unsubscribe()
          resolve(synced)
        }
        const timeout = setTimeout(() => finish(false), timeoutMs)
        const unsubscribe = state.subscribe((s) => {
          if (done(s)) finish(s.synced)
        })
      })
    },
    destroy() {
      // 先に自分の presence を消して送る。サーバも切断で消すが、届くまでの間に古い選択が見えないようにする
      if (awareness.getLocalState() !== null) {
        awarenessProtocol.removeAwarenessStates(awareness, [awareness.clientID], 'destroy')
      }
      destroyed = true
      clearTimeout(timer)
      doc.off('update', onDocUpdate)
      awareness.off('update', onAwarenessUpdate)
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
      }
      const ws = socket
      socket = undefined
      ws?.close(1000, 'closing')
      forgetPeers()
      state.setState({ status: 'closed', synced: false })
    },
  }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest
  const Y = await import('yjs')
  const { createFakeSyncServer } = await import('./fake-sync-server')

  const SYNC_URL = 'wss://sync.test/v1/projects/p/sync'
  const providers: SyncProvider[] = []
  const awarenesses: awarenessProtocol.Awareness[] = []
  afterEach(() => {
    for (const p of providers.splice(0)) p.destroy()
    for (const a of awarenesses.splice(0)) a.destroy()
  })

  const connectClient = (
    server: ReturnType<typeof createFakeSyncServer>,
    overrides: Partial<SyncProviderOptions> = {},
  ) => {
    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    const provider = createSyncProvider({
      url: async () => SYNC_URL,
      doc,
      awareness,
      createSocket: (url) => server.createSocket(url),
      minReconnectMs: 5,
      maxReconnectMs: 20,
      ...overrides,
    })
    providers.push(provider)
    awarenesses.push(awareness)
    return { doc, awareness, provider, text: doc.getMap<string>('m') }
  }

  describe('createSyncProvider', () => {
    test('two clients exchange their documents through the server', async () => {
      const server = createFakeSyncServer()
      const a = connectClient(server)
      a.text.set('before', 'a')
      const b = connectClient(server)
      expect(await b.provider.whenSynced(1000)).toBe(true)
      expect(b.text.get('before')).toBe('a')

      b.text.set('after', 'b')
      await vi.waitFor(() => expect(a.text.get('after')).toBe('b'))
      expect(server.doc.getMap('m').toJSON()).toEqual({ before: 'a', after: 'b' })
    })

    test('awareness states reach the other client and are removed when it leaves', async () => {
      const server = createFakeSyncServer()
      const a = connectClient(server)
      const b = connectClient(server)
      a.awareness.setLocalState({ name: 'a' })
      await vi.waitFor(() =>
        expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ name: 'a' }),
      )
      const c = connectClient(server)
      await vi.waitFor(() =>
        expect(c.awareness.getStates().get(a.doc.clientID)).toEqual({ name: 'a' }),
      )

      a.provider.destroy()
      await vi.waitFor(() => expect(b.awareness.getStates().has(a.doc.clientID)).toBe(false))
      expect(a.provider.state.getState().status).toBe('closed')
    })

    test('edits made while disconnected are merged after reconnecting', async () => {
      const server = createFakeSyncServer()
      const a = connectClient(server)
      const b = connectClient(server)
      await a.provider.whenSynced(1000)
      await b.provider.whenSynced(1000)
      b.awareness.setLocalState({ name: 'b' })
      await vi.waitFor(() => expect(a.awareness.getStates().has(b.doc.clientID)).toBe(true))

      server.setOnline(false)
      server.disconnectAll()
      await vi.waitFor(() => expect(a.provider.state.getState().status).toBe('connecting'))
      expect(a.awareness.getStates().has(b.doc.clientID)).toBe(false)
      a.text.set('a', 'offline')
      b.text.set('b', 'offline')

      server.setOnline(true)
      await vi.waitFor(() => {
        expect(a.text.toJSON()).toEqual({ a: 'offline', b: 'offline' })
        expect(b.text.toJSON()).toEqual(a.text.toJSON())
      })
      expect(a.provider.state.getState()).toEqual({ status: 'connected', synced: true })
    })

    test('presence comes back when only one client reconnects', async () => {
      const server = createFakeSyncServer()
      const sockets: ReturnType<typeof server.createSocket>[] = []
      const a = connectClient(server, {
        createSocket: (url) => {
          const socket = server.createSocket(url)
          sockets.push(socket)
          return socket
        },
      })
      const b = connectClient(server)
      a.awareness.setLocalState({ name: 'a' })
      b.awareness.setLocalState({ name: 'b' })
      await vi.waitFor(() => {
        expect(a.awareness.getStates().get(b.doc.clientID)).toEqual({ name: 'b' })
        expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ name: 'a' })
      })

      const removedFromB: number[] = []
      b.awareness.on('change', ({ removed }: { removed: number[] }) =>
        removedFromB.push(...removed),
      )
      sockets[0]?.close()
      await vi.waitFor(() => {
        expect(removedFromB).toContain(a.doc.clientID)
        expect(sockets.length).toBe(2)
        expect(a.awareness.getStates().get(b.doc.clientID)).toEqual({ name: 'b' })
        expect(b.awareness.getStates().get(a.doc.clientID)).toEqual({ name: 'a' })
      })
    })

    test('waits while there is no URL yet and connects once there is', async () => {
      const server = createFakeSyncServer()
      let url: string | null = null
      const a = connectClient(server, { url: async () => url })
      expect(await a.provider.whenSynced(20)).toBe(false)
      expect(a.provider.state.getState().status).toBe('offline')
      url = SYNC_URL
      expect(await a.provider.whenSynced(1000)).toBe(true)
    })

    test('a deleted project closes the connection for good', async () => {
      const server = createFakeSyncServer()
      const a = connectClient(server)
      await a.provider.whenSynced(1000)
      server.disconnectAll(CLOSE_PROJECT_DELETED)
      await vi.waitFor(() => expect(a.provider.state.getState().status).toBe('closed'))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(server.connections).toBe(0)
      expect(await a.provider.whenSynced(1000)).toBe(false)
    })
  })
}
