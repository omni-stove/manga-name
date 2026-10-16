import type { Project } from '@manga/schema'
import { type CSSProperties, useSyncExternalStore } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { Collaboration } from './project-library'
import { findPage } from './project-ops'
import type { Peer } from './store/presence'
import type { SyncProviderState, SyncStatus } from './store/sync-provider'

// useStore は毎回同じ順で呼ぶ必要があるので、共同編集でないときは空の store を読ませる
const NO_PEERS = createStore<Peer[]>()(() => [])
const NO_SYNC = createStore<SyncProviderState>()(() => ({ status: 'closed', synced: false }))

/** 同じプロジェクトを開いている他のクライアント。共同編集でなければ空 */
export function usePeers(collab: Collaboration | undefined): Peer[] {
  const store = collab?.presence.peers ?? NO_PEERS
  // zustand の useStore は SSR で初期状態を返すので、描画時点の他のクライアントが出るよう getState を渡す
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

const SYNC_STATUS: Record<SyncStatus, string> = {
  connecting: '接続中…',
  connected: '共同編集中',
  offline: 'オフライン（復帰後に同期）',
  closed: '共同編集は終了しました',
}

export const peerColor = (color: string) => ({ '--peer-color': color }) as CSSProperties

/** カーソル色の印と名前 */
export function PeerBadge({ name, color, title }: { name: string; color: string; title?: string }) {
  return (
    <span className="peer" style={peerColor(color)} title={title}>
      {name}
    </span>
  )
}

/** 共同編集の接続状態と、自分と他のクライアントをカーソル色で並べる。共同編集でなければ何も出さない */
export function CollaborationBar({
  collab,
  project,
}: {
  collab: Collaboration | undefined
  project: Project
}) {
  const peers = usePeers(collab)
  const { status, synced } = useStore(collab?.sync ?? NO_SYNC)
  if (!collab) return null
  const where = (peer: Peer) => {
    const found = peer.pageId === null ? undefined : findPage(project, peer.pageId)
    return found ? `${found.pageIndex + 1} ページを編集中` : undefined
  }
  return (
    <span className="collab-bar">
      <span className="sync-status" data-status={status}>
        {status === 'connected' && !synced ? '同期中…' : SYNC_STATUS[status]}
      </span>
      <ul className="peers" aria-label="開いている人">
        <li>
          <PeerBadge name="自分" color={collab.presence.color} />
        </li>
        {peers.map((peer) => (
          <li key={peer.clientId}>
            <PeerBadge name={peer.name} color={peer.color} title={where(peer)} />
          </li>
        ))}
      </ul>
    </span>
  )
}
