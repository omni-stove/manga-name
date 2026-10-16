import { type ReactNode, useEffect, useRef } from 'react'
import styles from './dialog.module.css'

interface DialogProps {
  title: string
  /** キャンセル、Esc、背景外の close で呼ぶ */
  onClose(): void
  /** 渡すと中身を form で包み、送信で呼ぶ。Enter で送れる */
  onSubmit?(): void
  /** 右下に並べるボタン */
  actions?: ReactNode
  children: ReactNode
}

/** モーダル。開いている間だけマウントし、マウントで showModal する */
export function Dialog({ title, onClose, onSubmit, actions, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    // jsdom は showModal を持たない
    if (dialog && !dialog.open) dialog.showModal?.()
  }, [])
  const body = (
    <>
      <h2 className={styles.title}>{title}</h2>
      {children}
      {actions && <div className={styles.actions}>{actions}</div>}
    </>
  )
  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} aria-label={title}>
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
