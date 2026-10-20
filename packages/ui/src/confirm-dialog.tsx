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
  /** キャンセルか Esc で呼ぶ */
  onCancel(): void
}

/** 削除などの前に確かめるモーダル。確定はボタンか Enter、取り消しはキャンセルか Esc。背景のクリックでは閉じない */
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
      // 押し間違いで取り消しにならないよう、選ぶまで閉じない
      closeOnBackdrop={false}
      onSubmit={onConfirm}
      actions={
        <>
          <Button onClick={onCancel}>{m.cancel()}</Button>
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
