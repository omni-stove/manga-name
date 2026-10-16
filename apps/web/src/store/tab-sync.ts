/** ページから SharedWorker の同期サーバへ送るもの */
export type TabSyncRequest =
  | { type: 'send'; data: Uint8Array }
  | { type: 'close'; code?: number; reason?: string }

/** SharedWorker の同期サーバからページへ届くもの */
export type TabSyncReply =
  | { type: 'open' }
  | { type: 'message'; data: ArrayBuffer }
  | { type: 'close'; code: number; reason: string }

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
