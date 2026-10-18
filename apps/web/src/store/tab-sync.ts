import type { TabSyncReply, TabSyncRequest } from './tab-sync-protocol'

type Handler = ((event: never) => void) | null

const fire = (handler: Handler, event: object) =>
  (handler as ((event: object) => void) | null)?.(event)

/**
 * 同じブラウザのタブ同士を、SharedWorker の中の同期サーバ（createFakeSyncServer）でつなぐ。
 * 返す関数を SyncProviderOptions.createSocket に渡すと、WebSocket の代わりに URL ごとのサーバへつながる。
 * e2e で、workers/api とログインなしに 2 つのタブの共同編集を動かすのに使う。
 */
export function createTabSync(): (url: string) => WebSocket {
  let worker: SharedWorker | undefined
  const sockets = new Set<{ close(): void }>()
  // SharedWorker はタブを閉じたことを知れないので、閉じる前に切っておかないと離脱が他のタブに届かない
  window.addEventListener('pagehide', () => {
    for (const socket of [...sockets]) socket.close()
  })

  return (url) => {
    worker ??= new SharedWorker(new URL('./tab-sync.worker.ts', import.meta.url), {
      type: 'module',
      name: 'manga-tab-sync',
    })
    const channel = new MessageChannel()
    const port = channel.port1
    const request = (message: TabSyncRequest) => port.postMessage(message)
    const socket = {
      binaryType: 'blob',
      readyState: 0,
      onopen: null as Handler,
      onmessage: null as Handler,
      onclose: null as Handler,
      onerror: null as Handler,
      send(data: Uint8Array) {
        if (socket.readyState !== 1) throw new Error('the socket is not open')
        request({ type: 'send', data: data.slice() })
      },
      close(code = 1000, reason = '') {
        if (socket.readyState >= 2) return
        socket.readyState = 2
        request({ type: 'close', code, reason })
      },
    }
    sockets.add(socket)
    port.onmessage = (e: MessageEvent<TabSyncReply>) => {
      const reply = e.data
      if (reply.type === 'open') {
        socket.readyState = 1
        fire(socket.onopen, {})
      } else if (reply.type === 'message') {
        fire(socket.onmessage, { data: reply.data })
      } else {
        socket.readyState = 3
        sockets.delete(socket)
        port.close()
        fire(socket.onclose, { code: reply.code, reason: reply.reason })
      }
    }
    worker.port.postMessage({ url }, [channel.port2])
    return socket as unknown as WebSocket
  }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest
  const Y = await import('yjs')
  const awarenessProtocol = await import('y-protocols/awareness')
  const { createSyncProvider } = await import('./sync-provider')

  // tab-sync.worker は読み込んだときの self に onconnect を置くので、SharedWorker の代わりに受け取る入れ物を渡す
  const workerScope: { onconnect: ((e: { ports: MessagePort[] }) => void) | null } = {
    onconnect: null,
  }
  vi.stubGlobal('self', workerScope)
  await import('./tab-sync.worker')
  vi.unstubAllGlobals()

  /** 同じ名前の SharedWorker はタブをまたいで 1 つなので、どのタブからも同じ workerScope につなぐ */
  class FakeSharedWorker {
    readonly port: MessagePort
    constructor() {
      const channel = new MessageChannel()
      this.port = channel.port1
      workerScope.onconnect?.({ ports: [channel.port2] })
    }
  }

  const tabs: { window: EventTarget; createSocket: (url: string) => WebSocket }[] = []
  const openTab = () => {
    const window = new EventTarget()
    vi.stubGlobal('window', window)
    vi.stubGlobal('SharedWorker', FakeSharedWorker)
    const tab = { window, createSocket: createTabSync() }
    tabs.push(tab)
    return tab
  }

  afterEach(() => {
    for (const tab of tabs.splice(0)) tab.window.dispatchEvent(new Event('pagehide'))
    vi.unstubAllGlobals()
  })

  const connect = (createSocket: (url: string) => WebSocket, url = 'tab-sync:shared') => {
    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    const provider = createSyncProvider({
      url: async () => url,
      doc,
      awareness,
      createSocket,
    })
    return { doc, awareness, provider, map: doc.getMap<string>('m') }
  }
  const opened = (socket: WebSocket) =>
    new Promise<void>((resolve) => {
      socket.onopen = () => resolve()
    })

  describe('createTabSync', () => {
    test('a socket opens through the worker and refuses to send before that', async () => {
      const socket = openTab().createSocket('tab-sync:p')
      expect(socket.readyState).toBe(0)
      expect(() => socket.send(new Uint8Array([1]))).toThrow('not open')
      await opened(socket)
      expect(socket.readyState).toBe(1)
    })

    test('two tabs on the same URL edit one document', async () => {
      const a = connect(openTab().createSocket)
      const b = connect(openTab().createSocket)
      try {
        a.map.set('from', 'a')
        expect(await b.provider.whenSynced(1000)).toBe(true)
        await vi.waitFor(() => expect(b.map.get('from')).toBe('a'))
        b.map.set('reply', 'b')
        await vi.waitFor(() => expect(a.map.get('reply')).toBe('b'))
      } finally {
        for (const c of [a, b]) {
          c.provider.destroy()
          c.awareness.destroy()
        }
      }
    })

    test('different URLs do not share a document', async () => {
      const a = connect(openTab().createSocket, 'tab-sync:one')
      const b = connect(openTab().createSocket, 'tab-sync:two')
      try {
        a.map.set('from', 'a')
        expect(await a.provider.whenSynced(1000)).toBe(true)
        expect(await b.provider.whenSynced(1000)).toBe(true)
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(b.map.get('from')).toBeUndefined()
      } finally {
        for (const c of [a, b]) {
          c.provider.destroy()
          c.awareness.destroy()
        }
      }
    })

    test('close reports the close once the worker confirms it', async () => {
      const socket = openTab().createSocket('tab-sync:p')
      await opened(socket)
      const closed = new Promise<CloseEvent>((resolve) => {
        socket.onclose = resolve
      })
      socket.close(4000, 'bye')
      expect(socket.readyState).toBe(2)
      socket.close()
      expect(await closed).toEqual({ code: 4000, reason: 'bye' })
      expect(socket.readyState).toBe(3)
    })

    test('pagehide closes the open sockets of the tab', async () => {
      const tab = openTab()
      const socket = tab.createSocket('tab-sync:p')
      await opened(socket)
      const closed = new Promise<CloseEvent>((resolve) => {
        socket.onclose = resolve
      })
      tab.window.dispatchEvent(new Event('pagehide'))
      expect((await closed).code).toBe(1000)
    })
  })
}
