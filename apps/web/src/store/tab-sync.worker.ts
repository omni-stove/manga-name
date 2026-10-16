import { createFakeSyncServer } from './fake-sync-server'
import type { TabSyncReply, TabSyncRequest } from './tab-sync'

// lib が DOM なので self は Window の型になる。SharedWorker として使う分だけ型を付ける
const scope = self as unknown as { onconnect: ((e: MessageEvent) => void) | null }

const servers = new Map<string, ReturnType<typeof createFakeSyncServer>>()

/** 1 つの MessagePort を、URL ごとの同期サーバへの 1 接続として中継する */
const relay = (port: MessagePort, url: string) => {
  let server = servers.get(url)
  if (!server) {
    server = createFakeSyncServer()
    servers.set(url, server)
  }
  const reply = (message: TabSyncReply) => port.postMessage(message)
  const socket = server.createSocket(url)
  socket.onopen = () => reply({ type: 'open' })
  socket.onmessage = (e: MessageEvent<ArrayBuffer>) => reply({ type: 'message', data: e.data })
  socket.onclose = (e: CloseEvent) => {
    reply({ type: 'close', code: e.code, reason: e.reason })
    port.close()
  }
  port.onmessage = (e: MessageEvent<TabSyncRequest>) => {
    if (e.data.type === 'send') socket.send(new Uint8Array(e.data.data))
    else socket.close(e.data.code, e.data.reason)
  }
}

scope.onconnect = (e) => {
  const [control] = e.ports
  if (!control) return
  control.onmessage = (m: MessageEvent<{ url: string }>) => {
    const [port] = m.ports
    if (port) relay(port, m.data.url)
  }
}
