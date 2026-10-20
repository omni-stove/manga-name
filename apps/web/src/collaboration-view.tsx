import type { SyncProviderState, SyncStatus } from '@manga/collab'
import { m } from '@manga/i18n'
import type { Project } from '@manga/schema'
import { XStack } from '@manga/ui'
import { type CSSProperties, useSyncExternalStore } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import styles from './collaboration-view.module.css'
import type { Collaboration } from './project-library'
import { findPage } from './project-ops'
import type { Peer } from './store/presence'

// useStore は毎回同じ順で呼ぶ必要があるので、共同編集でないときは空の store を読ませる
const NO_PEERS = createStore<Peer[]>()(() => [])
const NO_SYNC = createStore<SyncProviderState>()(() => ({ status: 'closed', synced: false }))

/** 同じプロジェクトを開いている他のクライアント。共同編集でなければ空 */
export function usePeers(collab: Collaboration | undefined): Peer[] {
  const store = collab?.presence.peers ?? NO_PEERS
  // zustand の useStore は SSR で初期状態を返すので、描画時点の他のクライアントが出るよう getState を渡す
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

const SYNC_STATUS: Record<SyncStatus, () => string> = {
  connecting: () => m.web_collab_connecting(),
  connected: () => m.web_collab_connected(),
  offline: () => m.web_collab_offline(),
  closed: () => m.web_collab_closed(),
}

export const peerColor = (color: string) => ({ '--peer-color': color }) as CSSProperties

/** カーソル色の印と名前 */
export function PeerBadge({ name, color, title }: { name: string; color: string; title?: string }) {
  return (
    <XStack as="span" gap={4} className={styles.peer} style={peerColor(color)} title={title}>
      {name}
    </XStack>
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
    return found ? m.web_collab_editing_page({ page: found.pageIndex + 1 }) : undefined
  }
  return (
    <XStack as="span" gap={12} className={styles.bar}>
      <span className={styles.syncStatus} data-status={status}>
        {status === 'connected' && !synced ? m.web_collab_syncing() : SYNC_STATUS[status]()}
      </span>
      <XStack
        as="ul"
        wrap
        gap={4}
        align="stretch"
        className={styles.peers}
        aria-label={m.web_collab_peers()}
      >
        <li>
          <PeerBadge name={m.web_collab_self()} color={collab.presence.color} />
        </li>
        {peers.map((peer) => (
          <li key={peer.clientId}>
            <PeerBadge name={peer.name} color={peer.color} title={where(peer)} />
          </li>
        ))}
      </XStack>
    </XStack>
  )
}
