import { m } from '@manga/i18n'
import { Button } from '@manga/ui'
import { useStore } from 'zustand'
import { errorMessage } from './route-error'
import styles from './save-status.module.css'
import type { SaveStatus, WebProjectStore } from './store/project-store-types'
import { SyncStatusIndicator } from './sync-status'

const LABEL: Record<SaveStatus, () => string> = {
  saved: () => m.web_save_status_saved(),
  pending: () => m.web_save_status_pending(),
  saving: () => m.web_save_status_saving(),
  error: () => m.web_save_status_error(),
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
        {LABEL[saveStatus]()}
      </span>
      {saveStatus === 'error' && (
        <Button size="small" onClick={() => void store.flush()}>
          {m.web_save_status_retry()}
        </Button>
      )}
      <SyncStatusIndicator />
    </>
  )
}
