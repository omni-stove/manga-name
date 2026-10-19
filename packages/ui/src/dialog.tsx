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

function outside(r: DOMRect, x: number, y: number) {
  return x < r.left || x > r.right || y < r.top || y > r.bottom
}

/** pointer が dialog の枠の外、つまり ::backdrop の上にあるか */
function onBackdrop(e: MouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return false
  return outside(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)
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
    // biome-ignore lint/a11y/useKeyWithClickEvents: 背景のクリックは ::backdrop 向けの操作で、キーボードでは Esc の close が同じ役を担う
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

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('outside is true only beyond the rect on any side', () => {
    const r = { left: 10, right: 20, top: 10, bottom: 20 } as DOMRect
    expect(outside(r, 15, 15)).toBe(false)
    expect(outside(r, 5, 15)).toBe(true)
    expect(outside(r, 25, 15)).toBe(true)
    expect(outside(r, 15, 5)).toBe(true)
    expect(outside(r, 15, 25)).toBe(true)
  })
}
