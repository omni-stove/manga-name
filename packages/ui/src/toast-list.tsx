import { m } from '@manga/i18n'
import { Button, IconButton } from './button'
import styles from './toast-list.module.css'

export interface ToastItem {
  id: number
  kind: 'error' | 'info'
  message: string
  /** 通知の横に出すボタン。押すと通知を閉じる */
  action?: { label: string; onClick(): void }
}

/** 画面右下の通知の並び。通知の出し入れは呼び出し側が持つ */
export function ToastList({
  items,
  onDismiss,
}: {
  items: readonly ToastItem[]
  onDismiss(id: number): void
}) {
  if (items.length === 0) return null
  return (
    <ol className={styles.list} aria-live="assertive">
      {items.map((toast) => (
        <li key={toast.id} className={styles.toast} data-kind={toast.kind} role="alert">
          <span className={styles.message}>{toast.message}</span>
          {toast.action && (
            <Button
              size="small"
              onClick={() => {
                toast.action?.onClick()
                onDismiss(toast.id)
              }}
            >
              {toast.action.label}
            </Button>
          )}
          <IconButton label={m.ui_toast_dismiss()} size="small" onClick={() => onDismiss(toast.id)}>
            ×
          </IconButton>
        </li>
      ))}
    </ol>
  )
}
