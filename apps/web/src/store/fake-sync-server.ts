import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_QUERY_AWARENESS = 3

type Handler = ((event: never) => void) | null

interface FakeSocket {
  binaryType: string
  readyState: number
  onopen: Handler
  onmessage: Handler
  onclose: Handler
  onerror: Handler
  send(data: Uint8Array): void
  close(code?: number, reason?: string): void
}

interface Connection {
  socket: FakeSocket
  /** この接続が名乗った awareness の clientID と最後の clock */
  clients: Map<number, number>
}

/** テスト用の同期サーバ */
interface FakeSyncServer {
  /** サーバが持つ Y.Doc */
  readonly doc: Y.Doc
  /** SyncProviderOptions.createSocket に渡す。本物の WebSocket の代わりにこのサーバへつなぐ */
  createSocket(url: string): WebSocket
  /** false の間は新しい接続を受けずに閉じる */
  setOnline(online: boolean): void
  /** すべての接続をサーバ側から閉じる */
  disconnectAll(code?: number): void
  /** 開いている接続の数 */
  readonly connections: number
}

const fire = (handler: Handler, event: object) =>
  (handler as ((event: object) => void) | null)?.(event)

function message(type: number, write: (encoder: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

/**
 * workers/api の ProjectRoom と同じく y-websocket のプロトコルで、接続間に Yjs の更新と awareness を中継するプロセス内のサーバ。
 * 接続すると SyncStep1 を送り、他の接続に query-awareness を送る。切断した接続の awareness は他の接続に離脱として送る。
 * メッセージは microtask で届け、ネットワーク越しと同じく送信の呼び出しの中では処理しない。
 */
export function createFakeSyncServer(): FakeSyncServer {
  const doc = new Y.Doc()
  const open = new Set<Connection>()
  let online = true

  const deliver = (conn: Connection, data: Uint8Array) => {
    const copy = data.slice()
    queueMicrotask(() => {
      if (open.has(conn)) fire(conn.socket.onmessage, { data: copy.buffer })
    })
  }

  const broadcast = (data: Uint8Array, except?: unknown) => {
    for (const conn of open) if (conn !== except) deliver(conn, data)
  }

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    broadcast(
      message(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, update)),
      origin,
    )
  })

  const awarenessRemoval = (clients: Map<number, number>) =>
    message(MESSAGE_AWARENESS, (e) => {
      const update = encoding.createEncoder()
      encoding.writeVarUint(update, clients.size)
      for (const [clientId, clock] of clients) {
        encoding.writeVarUint(update, clientId)
        encoding.writeVarUint(update, clock + 1)
        encoding.writeVarString(update, 'null')
      }
      encoding.writeVarUint8Array(e, encoding.toUint8Array(update))
    })

  const drop = (conn: Connection, code: number, reason: string) => {
    if (!open.delete(conn)) return
    conn.socket.readyState = 3
    if (conn.clients.size > 0) broadcast(awarenessRemoval(conn.clients))
    queueMicrotask(() => fire(conn.socket.onclose, { code, reason }))
  }

  const receive = (conn: Connection, bytes: Uint8Array) => {
    const decoder = decoding.createDecoder(bytes)
    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn)
        if (encoding.length(encoder) > 1) deliver(conn, encoding.toUint8Array(encoder))
        break
      }
      case MESSAGE_AWARENESS: {
        const update = decoding.createDecoder(decoding.readVarUint8Array(decoder))
        const count = decoding.readVarUint(update)
        for (let i = 0; i < count; i++) {
          const clientId = decoding.readVarUint(update)
          const clock = decoding.readVarUint(update)
          if (decoding.readVarString(update) === 'null') conn.clients.delete(clientId)
          else conn.clients.set(clientId, clock)
        }
        broadcast(bytes, conn)
        break
      }
      case MESSAGE_QUERY_AWARENESS:
        broadcast(bytes, conn)
        break
    }
  }

  return {
    doc,
    createSocket() {
      const socket: FakeSocket = {
        binaryType: 'blob',
        readyState: 0,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send(data) {
          if (socket.readyState !== 1) throw new Error('the socket is not open')
          const copy = data.slice()
          queueMicrotask(() => {
            if (open.has(conn)) receive(conn, copy)
          })
        },
        close(code = 1000, reason = '') {
          if (socket.readyState === 0) {
            socket.readyState = 3
            queueMicrotask(() => fire(socket.onclose, { code, reason }))
            return
          }
          drop(conn, code, reason)
        },
      }
      const conn: Connection = { socket, clients: new Map() }
      setTimeout(() => {
        if (socket.readyState !== 0) return
        if (!online) {
          socket.readyState = 3
          fire(socket.onclose, { code: 1006, reason: '' })
          return
        }
        open.add(conn)
        socket.readyState = 1
        fire(socket.onopen, {})
        deliver(
          conn,
          message(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, doc)),
        )
        broadcast(
          message(MESSAGE_QUERY_AWARENESS, () => {}),
          conn,
        )
      }, 0)
      return socket as unknown as WebSocket
    },
    setOnline(value) {
      online = value
    },
    disconnectAll(code = 1006) {
      for (const conn of [...open]) drop(conn, code, '')
    },
    get connections() {
      return open.size
    },
  }
}
