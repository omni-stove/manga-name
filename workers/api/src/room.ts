import { DurableObject } from 'cloudflare:workers'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { type ProjectRole, updateAllowed } from './access'
import type { Env } from './env'
import { readYDocSnapshot, writeYDocSnapshot } from './project-store'
import { createRoomStorage, type RoomStorage } from './room-storage'

/** Worker が DO に渡す、接続先のプロジェクト id */
export const PROJECT_ID_HEADER = 'x-project-id'
/** Worker が DO に渡す、接続したユーザーの id とロール */
export const USER_ID_HEADER = 'x-project-user'
export const ROLE_HEADER = 'x-project-role'

const ROLES: readonly string[] = ['owner', 'editor', 'commenter', 'viewer'] satisfies ProjectRole[]

/** y-websocket のメッセージ種別 */
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_QUERY_AWARENESS = 3

/** 1 メッセージの上限（バイト）。PUT で受ける Project JSON の上限と揃える */
const MAX_MESSAGE_BYTES = 5 * 1024 * 1024

/** D1 にまだ書いていない最初の更新から、D1 にスナップショットを書くまでの間隔 */
const SNAPSHOT_INTERVAL_MS = 30_000

/** 1 接続が名乗れる Awareness の clientID の数。attachment の 2KB に収めるため */
const MAX_CLIENTS_PER_SOCKET = 16

/** プロジェクトが削除されたときに接続を閉じるコード */
export const CLOSE_PROJECT_DELETED = 4404
/** ロールで許されない変更を送ってきた接続を閉じるコード。つなぎ直しても同じ変更を送るだけなので、クライアントはつなぎ直さない */
export const CLOSE_FORBIDDEN = 4403
/** ロールが変わったか外された接続を閉じるコード。つなぎ直させて、新しいロールで受け直す */
export const CLOSE_ACCESS_CHANGED = 4401

const PROJECT_ID_KEY = 'projectId'

/** 各 WebSocket に serializeAttachment で持たせる情報。ハイバネーションから戻っても残る */
interface Attachment {
  projectId: string
  userId: string
  role: ProjectRole
  /** この接続が送ってきた Awareness の clientID と最後の clock */
  clients: Record<string, number>
}

function message(type: number, write: (encoder: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

/** Awareness 更新の各エントリの clientID と clock と、状態が null（離脱）か */
function readAwarenessEntries(update: Uint8Array) {
  const decoder = decoding.createDecoder(update)
  const count = decoding.readVarUint(decoder)
  const entries: { clientId: number; clock: number; removed: boolean }[] = []
  for (let i = 0; i < count; i++) {
    const clientId = decoding.readVarUint(decoder)
    const clock = decoding.readVarUint(decoder)
    const removed = decoding.readVarString(decoder) === 'null'
    entries.push({ clientId, clock, removed })
  }
  return entries
}

/** clients の各 clientID を離脱させる Awareness メッセージ。clock を進めないと受け手が無視する */
function awarenessRemoval(clients: Record<string, number>) {
  const entries = Object.entries(clients)
  const update = encoding.createEncoder()
  encoding.writeVarUint(update, entries.length)
  for (const [clientId, clock] of entries) {
    encoding.writeVarUint(update, Number(clientId))
    encoding.writeVarUint(update, clock + 1)
    encoding.writeVarString(update, 'null')
  }
  return message(MESSAGE_AWARENESS, (e) =>
    encoding.writeVarUint8Array(e, encoding.toUint8Array(update)),
  )
}

/** sync メッセージ bytes が運ぶ Yjs の更新を role が当ててよいなら true。更新を運ばない step 1 は常に true */
function writableBy(doc: Y.Doc, bytes: Uint8Array, role: ProjectRole): boolean {
  const decoder = decoding.createDecoder(bytes)
  decoding.readVarUint(decoder)
  const type = decoding.readVarUint(decoder)
  if (type !== syncProtocol.messageYjsSyncStep2 && type !== syncProtocol.messageYjsUpdate) return true
  return updateAllowed(doc, decoding.readVarUint8Array(decoder), role)
}

/**
 * DO storage から Y.Doc を組み立てる。DO storage が空なら D1 のスナップショットから復元し、
 * それを DO storage に書き戻す。どちらにも無ければ空の Y.Doc を返す。
 */
export async function restoreDoc(
  storage: RoomStorage,
  db: D1Database,
  projectId: string,
): Promise<Y.Doc> {
  const doc = new Y.Doc()
  if (await storage.load(doc)) return doc
  const saved = await readYDocSnapshot(db, projectId)
  if (saved) {
    Y.applyUpdate(doc, saved)
    storage.compact(doc)
  }
  return doc
}

/** ProjectRoom の中身。1 プロジェクトの Y.Doc を、接続中の WebSocket と DO storage と D1 に同期する */
function createRoom(ctx: DurableObjectState, env: Env) {
  const storage = createRoomStorage(ctx.storage)
  let opening: Promise<Y.Doc> | undefined
  let dirty = false
  let snapshotScheduled = false

  function broadcast(data: Uint8Array, except?: unknown) {
    for (const socket of ctx.getWebSockets()) {
      if (socket === except) continue
      try {
        socket.send(data)
      } catch {
        // 閉じかけの接続には送れない。webSocketClose で片付く
      }
    }
  }

  async function open(projectId: string) {
    const doc = await restoreDoc(storage, env.DB, projectId)
    // 送ってきた接続を origin にして適用するので、その接続には送り返さない
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      storage.append(doc, update)
      dirty = true
      broadcast(
        message(MESSAGE_SYNC, (e) => syncProtocol.writeUpdate(e, update)),
        origin,
      )
    })
    return doc
  }

  /** ハイバネーションや再起動の後、最初に触れた時点で 1 度だけ読み込む */
  function openDoc(projectId: string) {
    if (!opening) {
      const pending = open(projectId)
      opening = pending
      pending.catch(() => {
        if (opening === pending) opening = undefined
      })
    }
    return opening
  }

  async function scheduleSnapshot() {
    if (!dirty || snapshotScheduled) return
    snapshotScheduled = true
    dirty = false
    // 既にある alarm を後ろにずらすと、編集が続く間ずっと D1 に書かれなくなる
    if ((await ctx.storage.getAlarm()) === null) {
      await ctx.storage.setAlarm(Date.now() + SNAPSHOT_INTERVAL_MS)
    }
  }

  function closeAll(code: number, reason: string) {
    for (const socket of ctx.getWebSockets()) {
      try {
        socket.close(code, reason)
      } catch {
        // 既に閉じている
      }
    }
  }

  async function purge() {
    closeAll(CLOSE_PROJECT_DELETED, 'project deleted')
    opening = undefined
    dirty = false
    snapshotScheduled = false
    await ctx.storage.deleteAlarm()
    await storage.clear()
  }

  /** user の接続をすべて閉じる。ロールの変更と参加の取り消しを、つないだままの接続に効かせる */
  function revoke(userId: string) {
    for (const socket of ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null
      if (attachment?.userId !== userId) continue
      try {
        socket.close(CLOSE_ACCESS_CHANGED, 'access changed')
      } catch {
        // 既に閉じている
      }
    }
  }

  return {
    async connect(request: Request): Promise<Response> {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('expected a WebSocket upgrade', { status: 426 })
      }
      const projectId = request.headers.get(PROJECT_ID_HEADER)
      if (!projectId) return new Response(`${PROJECT_ID_HEADER} is required`, { status: 400 })
      const userId = request.headers.get(USER_ID_HEADER)
      const role = request.headers.get(ROLE_HEADER)
      if (!userId || !role || !ROLES.includes(role)) {
        return new Response(`${USER_ID_HEADER} and ${ROLE_HEADER} are required`, { status: 400 })
      }
      // alarm は接続を伴わずに起きるので、どのプロジェクトかを storage に残しておく
      await ctx.storage.put(PROJECT_ID_KEY, projectId)
      const doc = await openDoc(projectId)

      const { 0: client, 1: server } = new WebSocketPair()
      ctx.acceptWebSocket(server)
      server.serializeAttachment({
        projectId,
        userId,
        role: role as ProjectRole,
        clients: {},
      } satisfies Attachment)
      server.send(message(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, doc)))
      // 既存の接続に Awareness を送り直させ、新しい接続にも誰がいるかを伝える
      broadcast(
        message(MESSAGE_QUERY_AWARENESS, () => {}),
        server,
      )
      return new Response(null, { status: 101, webSocket: client })
    },

    async receive(ws: WebSocket, data: ArrayBuffer | string) {
      if (typeof data === 'string') {
        ws.close(1003, 'binary messages only')
        return
      }
      if (data.byteLength > MAX_MESSAGE_BYTES) {
        ws.close(1009, 'message too large')
        return
      }
      const attachment = ws.deserializeAttachment() as Attachment | null
      if (!attachment) {
        ws.close(1011, 'connection state lost')
        return
      }
      const doc = await openDoc(attachment.projectId)
      const bytes = new Uint8Array(data)
      try {
        const decoder = decoding.createDecoder(bytes)
        switch (decoding.readVarUint(decoder)) {
          case MESSAGE_SYNC: {
            if (!writableBy(doc, bytes, attachment.role)) {
              ws.close(CLOSE_FORBIDDEN, 'this role cannot make the change')
              return
            }
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, MESSAGE_SYNC)
            syncProtocol.readSyncMessage(decoder, encoder, doc, ws)
            if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder))
            break
          }
          case MESSAGE_AWARENESS: {
            const clients = new Map(Object.entries(attachment.clients))
            // query-awareness への返信には他の接続から中継された ID も入るので、他の接続が持つ ID は自分のものにしない
            const owned = new Set<string>()
            for (const socket of ctx.getWebSockets()) {
              if (socket === ws) continue
              const other = socket.deserializeAttachment() as Attachment | null
              for (const id of Object.keys(other?.clients ?? {})) owned.add(id)
            }
            for (const entry of readAwarenessEntries(decoding.readVarUint8Array(decoder))) {
              const key = String(entry.clientId)
              if (owned.has(key)) continue
              if (entry.removed) clients.delete(key)
              else if (clients.has(key) || clients.size < MAX_CLIENTS_PER_SOCKET) {
                clients.set(key, entry.clock)
              }
            }
            ws.serializeAttachment({
              ...attachment,
              clients: Object.fromEntries(clients),
            } satisfies Attachment)
            broadcast(bytes, ws)
            break
          }
          case MESSAGE_QUERY_AWARENESS:
            broadcast(bytes, ws)
            break
        }
      } catch {
        ws.close(1007, 'malformed message')
        return
      }
      await scheduleSnapshot()
    },

    disconnect(ws: WebSocket) {
      const attachment = ws.deserializeAttachment() as Attachment | null
      if (attachment && Object.keys(attachment.clients).length > 0) {
        broadcast(awarenessRemoval(attachment.clients), ws)
      }
      try {
        ws.close(1000, 'closing')
      } catch {
        // 相手から閉じられて既に閉じている
      }
    },

    /** alarm から呼ぶ。Y.Doc の状態を D1 に書く。プロジェクトが D1 から消えていれば自分も消す */
    async snapshot() {
      snapshotScheduled = false
      const projectId = await ctx.storage.get<string>(PROJECT_ID_KEY)
      if (projectId === undefined) return
      const doc = await openDoc(projectId)
      if (!(await writeYDocSnapshot(env.DB, projectId, Y.encodeStateAsUpdate(doc)))) {
        await purge()
      }
    },

    purge,
    revoke,
  }
}

/**
 * 1 プロジェクト 1 インスタンスの同期サーバ。`idFromName(projectId)` で引く。
 * y-websocket と同じプロトコルで Yjs の更新を接続間に中継し、DO storage に永続化し、
 * 更新があれば SNAPSHOT_INTERVAL_MS 以内に D1 の project_ydoc_chunks に書く。
 * 接続のロールで許されない更新（commenter の scribbles 以外、viewer のすべて）は当てずに CLOSE_FORBIDDEN で閉じる。
 * Durable Object はクラスでしか定義できないので、処理は createRoom に置いて委ねる。
 */
export class ProjectRoom extends DurableObject<Env> {
  private readonly room: ReturnType<typeof createRoom>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.room = createRoom(ctx, env)
  }

  override fetch(request: Request) {
    return this.room.connect(request)
  }

  override webSocketMessage(ws: WebSocket, data: ArrayBuffer | string) {
    return this.room.receive(ws, data)
  }

  override webSocketClose(ws: WebSocket) {
    this.room.disconnect(ws)
  }

  override webSocketError(ws: WebSocket) {
    this.room.disconnect(ws)
  }

  override alarm() {
    return this.room.snapshot()
  }

  /** user のロールが変わったか外されたときに、その接続を閉じる */
  revoke(userId: string) {
    this.room.revoke(userId)
  }

  /** プロジェクトの削除に合わせて、接続を閉じ DO storage を空にする */
  purge() {
    return this.room.purge()
  }
}
