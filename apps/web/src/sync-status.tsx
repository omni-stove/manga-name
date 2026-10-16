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

/** 子孫の useSyncState と SyncStatusIndicator が source の同期状態を読むようにする */
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

/** クラウドとの同期状態。クラウドを使わない構成では常に 'synced' */
export function useSyncState(): SyncState {
  return useSyncStatus().state
}

const LABEL: Record<SyncState, string> = {
  synced: '同期済み',
  pending: '同期待ち',
  offline: 'オフライン',
  conflict: '競合あり',
}

const TITLE: Record<SyncState, string> = {
  synced: '変更はクラウドに保存されています',
  pending: '変更をクラウドに送るのを待っています',
  offline: 'クラウドに届きません。つながり次第送ります',
  conflict:
    '他の端末の変更と競合したため、クラウド版を「（クラウド版）」付きの別プロジェクトとして残しました',
}

/** ログイン中のクラウドとの同期状態。競合は確認するまで、保存容量の上限超過は解消するまで出す */
export function SyncStatusIndicator() {
  const source = useContext(SyncStatusContext)
  const { user } = useAuth()
  const { state, quotaExceeded } = useSyncStatus()
  if (!source || user === null) return null
  return (
    <>
      <span className={styles.status} data-status={state} title={TITLE[state]}>
        {LABEL[state]}
      </span>
      {state === 'conflict' && (
        <Button size="small" variant="ghost" onClick={() => source.dismissConflict()}>
          確認
        </Button>
      )}
      {quotaExceeded && (
        <span className={styles.status} data-status="error">
          保存容量の上限です。画像はこの端末にだけあります。生成履歴を削除してください
        </span>
      )}
    </>
  )
}
