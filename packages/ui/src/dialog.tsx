import { type MouseEvent, type ReactNode, useLayoutEffect, useRef } from 'react'
import { cx } from './cx'
import styles from './dialog.module.css'
import { Typography } from './typography'

interface DialogProps {
  title: string
  /** Esc、背景のクリック、中のボタンなどで dialog が閉じたときに呼ぶ */
  onClose(): void
  /** false なら背景をクリックしても閉じない。既定は閉じる */
  closeOnBackdrop?: boolean
  /** 渡すと中身を form で包み、送信で呼ぶ。Enter で送れる */
  onSubmit?(): void
  /** 右下に並べるボタン */
  actions?: ReactNode
  children: ReactNode
  /** 幅を変えるなど、dialog に足すクラス */
  className?: string
}

/** pointer が dialog の枠の外、つまり ::backdrop の上にあるか */
function onBackdrop(e: MouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return false
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
}

/** モーダル。開いている間だけマウントし、マウントで showModal する。背景のクリックで閉じる */
export function Dialog({
  title,
  onClose,
  closeOnBackdrop = true,
  onSubmit,
  actions,
  children,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  // 中で押して外で離すと click は dialog 自身に出るので、押した位置も外のときだけ閉じる
  const pressedBackdrop = useRef(false)
  useLayoutEffect(() => {
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
    <dialog
      ref={ref}
      className={cx(styles.dialog, className)}
      onClose={onClose}
      onPointerDown={(e) => {
        pressedBackdrop.current = closeOnBackdrop && onBackdrop(e)
      }}
      onClick={(e) => {
        // closedby="any" は WKWebView（Tauri の macOS）で効くか分からないので JS で閉じる
        if (pressedBackdrop.current && onBackdrop(e)) e.currentTarget.close()
        pressedBackdrop.current = false
      }}
      aria-label={title}
    >
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
