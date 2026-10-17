import { type ReactNode, useEffect, useRef } from 'react'
import { cx } from './cx'
import styles from './dialog.module.css'
import { Typography } from './typography'

interface DialogProps {
  title: string
  /** キャンセル、Esc、背景外の close で呼ぶ */
  onClose(): void
  /** 渡すと中身を form で包み、送信で呼ぶ。Enter で送れる */
  onSubmit?(): void
  /** 右下に並べるボタン */
  actions?: ReactNode
  children: ReactNode
  /** 幅を変えるなど、dialog に足すクラス */
  className?: string
}

/** モーダル。開いている間だけマウントし、マウントで showModal する */
export function Dialog({ title, onClose, onSubmit, actions, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    // jsdom は showModal を持たない
    if (dialog && !dialog.open) dialog.showModal?.()
  }, [])
  const body = (
    <>
      <Typography variant="heading" className={styles.title}>
        {title}
      </Typography>
      {children}
      {actions && <div className={styles.actions}>{actions}</div>}
    </>
  )
  return (
    <dialog ref={ref} className={cx(styles.dialog, className)} onClose={onClose} aria-label={title}>
      {onSubmit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          {body}
        </form>
      ) : (
        body
      )}
    </dialog>
  )
}
