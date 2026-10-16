import type { ID } from '@manga/schema'
import type { Awareness } from 'y-protocols/awareness'
import { createStore, type StoreApi } from 'zustand/vanilla'

/** カーソル色。明暗どちらの背景でも線が見える彩度と明度にする */
const PRESENCE_COLORS = [
  '#e53935',
  '#1e88e5',
  '#43a047',
  '#fb8c00',
  '#8e24aa',
  '#00897b',
  '#d81b60',
  '#6d4c41',
] as const

/** Yjs の clientID からカーソル色を決める。全クライアントで同じ色になる */
const colorFor = (clientId: number) =>
  PRESENCE_COLORS[clientId % PRESENCE_COLORS.length] ?? PRESENCE_COLORS[0]

/** 表示する名前の長さの上限 */
const MAX_NAME_LENGTH = 40

/** 自分がどこで何を選んでいるか */
interface PresenceLocation {
  /** 開いているページ。エディタの外では null */
  pageId: ID | null
  /** 選択中のコマやフキダシの id */
  selection: ID[]
}

/** 同じプロジェクトを開いている他のクライアント */
export interface Peer extends PresenceLocation {
  clientId: number
  name: string
  color: string
}

/** awareness の各クライアントの状態。他のクライアントから届くので読むときに形を確かめる */
interface PresenceState extends PresenceLocation {
  name: string
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

function toPeer(clientId: number, state: unknown): Peer | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const { name, pageId, selection } = state as Record<string, unknown>
  if (typeof name !== 'string') return undefined
  const page = typeof pageId === 'string' ? pageId : pageId === null ? null : undefined
  if (page === undefined || !isStringArray(selection)) return undefined
  // 色を状態に載せないのは、CSS に入れる値を他のクライアントに決めさせないため
  return {
    clientId,
    name: name.slice(0, MAX_NAME_LENGTH),
    color: colorFor(clientId),
    pageId: page,
    selection,
  }
}

export interface Presence {
  /** 他のクライアント。clientID の昇順。形の合わない状態を送ってきたクライアントは含めない */
  readonly peers: StoreApi<Peer[]>
  /** 自分の色 */
  readonly color: string
  setLocation(location: PresenceLocation): void
  /** awareness の購読を外す。awareness 自体は破棄しない */
  destroy(): void
}

/**
 * `awareness` に自分の名前、開いているページ、選択を載せ、他のクライアントのそれを `peers` に出す。
 * 色は clientID から決めるので、相手の画面でも同じ色で見える。
 */
export function createPresence(awareness: Awareness, user: { name: string }): Presence {
  const color = colorFor(awareness.clientID)
  const peers = createStore<Peer[]>()(() => [])

  const read = () => {
    const next: Peer[] = []
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue
      const peer = toPeer(clientId, state)
      if (peer) next.push(peer)
    }
    next.sort((a, b) => a.clientId - b.clientId)
    peers.setState(next, true)
  }

  // setLocation のたびに peers を作り直して購読者を再描画しないよう、他のクライアントが変わったときだけ読む
  const onChange = ({
    added,
    updated,
    removed,
  }: {
    added: number[]
    updated: number[]
    removed: number[]
  }) => {
    if ([...added, ...updated, ...removed].some((id) => id !== awareness.clientID)) read()
  }

  awareness.setLocalState({ name: user.name, pageId: null, selection: [] } satisfies PresenceState)
  awareness.on('change', onChange)
  read()

  return {
    peers,
    color,
    setLocation({ pageId, selection }) {
      const current = awareness.getLocalState() as PresenceState | null
      // null は同期プロバイダが離脱を送った後。名乗り直すと閉じたはずの接続の presence が戻る
      if (
        !current ||
        (current.pageId === pageId &&
          current.selection.length === selection.length &&
          current.selection.every((id, i) => id === selection[i]))
      ) {
        return
      }
      awareness.setLocalState({ name: user.name, pageId, selection } satisfies PresenceState)
    },
    destroy() {
      awareness.off('change', onChange)
    },
  }
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const Y = await import('yjs')
  const awarenessProtocol = await import('y-protocols/awareness')

  /** 2 つの awareness の更新を互いに流す。同期プロバイダの代わり */
  const connect = (a: Awareness, b: Awareness) => {
    const peer = Symbol('peer')
    const forwardTo =
      (from: Awareness, to: Awareness) =>
      ({ added, updated, removed }: Record<string, number[]>, origin: unknown) => {
        if (origin === peer) return
        const changed = [...(added ?? []), ...(updated ?? []), ...(removed ?? [])]
        awarenessProtocol.applyAwarenessUpdate(
          to,
          awarenessProtocol.encodeAwarenessUpdate(from, changed),
          peer,
        )
      }
    a.on('update', forwardTo(a, b))
    b.on('update', forwardTo(b, a))
    awarenessProtocol.applyAwarenessUpdate(
      b,
      awarenessProtocol.encodeAwarenessUpdate(a, [a.clientID]),
      peer,
    )
    awarenessProtocol.applyAwarenessUpdate(
      a,
      awarenessProtocol.encodeAwarenessUpdate(b, [b.clientID]),
      peer,
    )
  }

  const setup = () => {
    const a = new awarenessProtocol.Awareness(new Y.Doc())
    const b = new awarenessProtocol.Awareness(new Y.Doc())
    const alice = createPresence(a, { name: 'alice' })
    const bob = createPresence(b, { name: 'bob' })
    connect(a, b)
    return { a, b, alice, bob }
  }

  describe('createPresence', () => {
    test('each client sees the other with its colour, page and selection', () => {
      const { a, b, alice, bob } = setup()
      bob.setLocation({ pageId: 'p1', selection: ['bubble-1'] })
      expect(alice.peers.getState()).toEqual([
        {
          clientId: b.clientID,
          name: 'bob',
          color: colorFor(b.clientID),
          pageId: 'p1',
          selection: ['bubble-1'],
        },
      ])
      expect(bob.peers.getState()).toEqual([
        expect.objectContaining({ clientId: a.clientID, name: 'alice', color: alice.color }),
      ])
      a.destroy()
      b.destroy()
    })

    test('a client that leaves disappears', () => {
      const { a, b, alice } = setup()
      awarenessProtocol.removeAwarenessStates(b, [b.clientID], 'test')
      expect(alice.peers.getState()).toEqual([])
      a.destroy()
      b.destroy()
    })

    test('states of an unexpected shape are ignored', () => {
      const a = new awarenessProtocol.Awareness(new Y.Doc())
      const alice = createPresence(a, { name: 'alice' })
      const other = new awarenessProtocol.Awareness(new Y.Doc())
      other.setLocalState({ name: 1, selection: 'x' })
      awarenessProtocol.applyAwarenessUpdate(
        a,
        awarenessProtocol.encodeAwarenessUpdate(other, [other.clientID]),
        'test',
      )
      expect(alice.peers.getState()).toEqual([])
      a.destroy()
      other.destroy()
    })

    test('setting the same location does not send an update', () => {
      const { a, b, bob } = setup()
      let updates = 0
      b.on('update', () => updates++)
      bob.setLocation({ pageId: 'p1', selection: ['x'] })
      bob.setLocation({ pageId: 'p1', selection: ['x'] })
      expect(updates).toBe(1)
      a.destroy()
      b.destroy()
    })

    test('colours are stable per client id', () => {
      expect(colorFor(3)).toBe(colorFor(3 + PRESENCE_COLORS.length))
      expect(PRESENCE_COLORS).toContain(colorFor(123456789))
    })
  })
}
