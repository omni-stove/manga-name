import * as Y from 'yjs'

const SNAPSHOT_PREFIX = 'snapshot:'
const UPDATE_PREFIX = 'update:'

/** スナップショット 1 キーの最大バイト数。KV 版 DO storage の 1 値 128KiB に収める */
const SNAPSHOT_CHUNK_BYTES = 64 * 1024

/** 1 回の put / delete に渡せるキーの上限 */
const KEYS_PER_CALL = 128

/** 溜まった更新がこれを超えたらスナップショットに畳む。読み込みで適用する更新の数を抑えるため */
const COMPACT_AFTER_UPDATES = 500
const COMPACT_AFTER_BYTES = 1024 * 1024

const snapshotKey = (seq: number) => `${SNAPSHOT_PREFIX}${String(seq).padStart(6, '0')}`
const updateKey = (seq: number) => `${UPDATE_PREFIX}${String(seq).padStart(10, '0')}`

function inBatches<T>(items: T[], run: (batch: T[]) => void) {
  for (let i = 0; i < items.length; i += KEYS_PER_CALL) run(items.slice(i, i + KEYS_PER_CALL))
}

function concat(chunks: Uint8Array[]) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** 1 プロジェクトの Y.Doc を DO storage に、スナップショットとその後の更新の列として持つ */
export interface RoomStorage {
  /** 保存済みのスナップショットと更新を doc に適用する。何も保存されていなければ false */
  load(doc: Y.Doc): Promise<boolean>
  /** doc に適用済みの update を書く。溜まりすぎていれば compact する */
  append(doc: Y.Doc, update: Uint8Array): void
  /** doc 全体を 1 つのスナップショットとして書き、それまでの更新を消す */
  compact(doc: Y.Doc): void
  /** 保存しているものをすべて消す */
  clear(): Promise<void>
}

/**
 * DO storage の上に RoomStorage を作る。load を先に呼んでから append / compact を使う。
 * append と compact は await せずに書き込みを発行する。DO の output gate が書き込みの確定まで
 * 応答の送信を止め、await を挟まない一連の書き込みは 1 つのアトミックな書き込みにまとまるため。
 */
export function createRoomStorage(storage: DurableObjectStorage): RoomStorage {
  let snapshotChunks = 0
  let updateKeys: string[] = []
  let updateBytes = 0
  let nextSeq = 0

  function compact(doc: Y.Doc) {
    const state = Y.encodeStateAsUpdate(doc)
    const entries: [string, Uint8Array][] = []
    for (let seq = 0; seq * SNAPSHOT_CHUNK_BYTES < Math.max(state.byteLength, 1); seq++) {
      entries.push([
        snapshotKey(seq),
        state.slice(seq * SNAPSHOT_CHUNK_BYTES, (seq + 1) * SNAPSHOT_CHUNK_BYTES),
      ])
    }
    const stale = [...updateKeys]
    for (let seq = entries.length; seq < snapshotChunks; seq++) stale.push(snapshotKey(seq))
    inBatches(entries, (batch) => void storage.put(Object.fromEntries(batch)))
    inBatches(stale, (batch) => void storage.delete(batch))
    snapshotChunks = entries.length
    updateKeys = []
    updateBytes = 0
  }

  return {
    async load(doc) {
      const [snapshot, updates] = await Promise.all([
        storage.list<Uint8Array>({ prefix: SNAPSHOT_PREFIX }),
        storage.list<Uint8Array>({ prefix: UPDATE_PREFIX }),
      ])
      snapshotChunks = snapshot.size
      updateKeys = [...updates.keys()]
      updateBytes = [...updates.values()].reduce((n, u) => n + u.byteLength, 0)
      const last = updateKeys.at(-1)
      nextSeq = last === undefined ? 0 : Number(last.slice(UPDATE_PREFIX.length)) + 1
      doc.transact(() => {
        if (snapshot.size > 0) Y.applyUpdate(doc, concat([...snapshot.values()]))
        for (const update of updates.values()) Y.applyUpdate(doc, update)
      })
      return snapshot.size > 0 || updates.size > 0
    },

    append(doc, update) {
      if (
        update.byteLength > SNAPSHOT_CHUNK_BYTES ||
        updateKeys.length + 1 > COMPACT_AFTER_UPDATES ||
        updateBytes + update.byteLength > COMPACT_AFTER_BYTES
      ) {
        compact(doc)
        return
      }
      const key = updateKey(nextSeq++)
      void storage.put(key, update)
      updateKeys.push(key)
      updateBytes += update.byteLength
    },

    compact,

    async clear() {
      await storage.deleteAll()
      snapshotChunks = 0
      updateKeys = []
      updateBytes = 0
      nextSeq = 0
    },
  }
}
