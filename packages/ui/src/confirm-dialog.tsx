import { m } from '@manga/i18n'
import { Button } from './button'
import { Dialog } from './dialog'
import { Typography } from './typography'

interface ConfirmDialogProps {
  title: string
  message: string
  /** 確定ボタンの文言 */
  confirmLabel: string
  /** 戻せない操作なら確定ボタンを danger にする */
  irreversible?: boolean
  onConfirm(): void
  /** キャンセル、Esc、背景外の close で呼ぶ */
  onCancel(): void
}

/** 削除などの前に確かめるモーダル。確定はボタンか Enter、取り消しはキャンセルか Esc */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  irreversible,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      onSubmit={onConfirm}
      actions={
        <>
          <Button onClick={onCancel}>{m.ui_confirm_dialog_cancel()}</Button>
          <Button type="submit" variant={irreversible ? 'danger' : 'primary'} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Typography>{message}</Typography>
    </Dialog>
  )
}
