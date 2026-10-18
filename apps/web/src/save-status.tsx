import { Button } from '@manga/ui'
import { useStore } from 'zustand'
import { errorMessage } from './route-error'
import styles from './save-status.module.css'
import type { SaveStatus, WebProjectStore } from './store/project-store'
import { SyncStatusIndicator } from './sync-status'

const LABEL: Record<SaveStatus, string> = {
  saved: '保存済み',
  pending: '未保存',
  saving: '保存中…',
  error: '保存に失敗しました',
}

/** store の保存状態とクラウドとの同期状態。保存に失敗していれば原因を title に出し、「再保存」を並べる */
export function SaveStatusIndicator({ store }: { store: WebProjectStore }) {
  const saveStatus = useStore(store.state, (s) => s.saveStatus)
  const saveError = useStore(store.state, (s) => s.saveError)
  return (
    <>
      <span
        className={styles.status}
        data-status={saveStatus}
        title={saveError === undefined ? undefined : errorMessage(saveError)}
      >
        {LABEL[saveStatus]}
      </span>
      {saveStatus === 'error' && (
        <Button size="small" onClick={() => void store.flush()}>
          再保存
        </Button>
      )}
      <SyncStatusIndicator />
    </>
  )
}
