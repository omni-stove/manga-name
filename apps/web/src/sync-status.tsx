import { m } from '@manga/i18n'
import type { CloudStorage, SyncState, SyncStatus } from '@manga/storage'
import { Button } from '@manga/ui'
import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react'
import styles from './save-status.module.css'
import { useAuth } from './use-auth'

type SyncStatusSource = Pick<
  CloudStorage,
  'getSyncStatus' | 'subscribeSyncStatus' | 'dismissConflict'
>

const SYNCED: SyncStatus = { state: 'synced', quotaExceeded: false }
const noSubscription = () => () => {}

// クラウドを使わない構成（API の URL が無い、テスト）では null で、同期状態を出さない
const SyncStatusContext = createContext<SyncStatusSource | null>(null)

/** 子孫の SyncStatusIndicator が source の同期状態を読むようにする */
export function SyncStatusProvider({
  source,
  children,
}: {
  source: SyncStatusSource | null
  children: ReactNode
}) {
  return <SyncStatusContext.Provider value={source}>{children}</SyncStatusContext.Provider>
}

function useSyncStatus(): SyncStatus {
  const source = useContext(SyncStatusContext)
  return useSyncExternalStore(
    source?.subscribeSyncStatus ?? noSubscription,
    source?.getSyncStatus ?? (() => SYNCED),
    () => SYNCED,
  )
}

const LABEL: Record<SyncState, () => string> = {
  synced: () => m.web_sync_status_synced(),
  pending: () => m.web_sync_status_pending(),
  offline: () => m.web_sync_status_offline(),
  conflict: () => m.web_sync_status_conflict(),
}

const TITLE: Record<SyncState, () => string> = {
  synced: () => m.web_sync_status_synced_title(),
  pending: () => m.web_sync_status_pending_title(),
  offline: () => m.web_sync_status_offline_title(),
  conflict: () => m.web_sync_status_conflict_title(),
}

/** ログイン中のクラウドとの同期状態。競合は確認するまで、保存容量の上限超過は解消するまで出す */
export function SyncStatusIndicator() {
  const source = useContext(SyncStatusContext)
  const { user } = useAuth()
  const { state, quotaExceeded } = useSyncStatus()
  if (!source || user === null) return null
  return (
    <>
      <span className={styles.status} data-status={state} title={TITLE[state]()}>
        {LABEL[state]()}
      </span>
      {state === 'conflict' && (
        <Button size="small" variant="ghost" onClick={() => source.dismissConflict()}>
          {m.web_sync_status_dismiss_conflict()}
        </Button>
      )}
      {quotaExceeded && (
        <span className={styles.status} data-status="error">
          {m.web_sync_status_quota_exceeded()}
        </span>
      )}
    </>
  )
}
