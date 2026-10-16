import { useStore } from 'zustand'
import type { SaveStatus, WebProjectStore } from './store/project-store'

const LABEL: Record<SaveStatus, string> = {
  saved: '保存済み',
  pending: '未保存',
  saving: '保存中…',
  error: '保存に失敗しました',
}

/** store の保存状態。失敗していれば原因を title に出し、「再保存」を並べる */
export function SaveStatusIndicator({ store }: { store: WebProjectStore }) {
  const saveStatus = useStore(store.state, (s) => s.saveStatus)
  const saveError = useStore(store.state, (s) => s.saveError)
  return (
    <>
      <span
        className={saveStatus === 'error' ? 'save-status error' : 'save-status'}
        title={saveError instanceof Error ? saveError.message : undefined}
      >
        {LABEL[saveStatus]}
      </span>
      {saveStatus === 'error' && (
        <button type="button" onClick={() => void store.flush()}>
          再保存
        </button>
      )}
    </>
  )
}
