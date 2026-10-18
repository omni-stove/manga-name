import type { ButtonHTMLAttributes } from 'react'
import styles from './button.module.css'
import { cx } from './cx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 既定は secondary。primary は画面に 1 つの主操作、danger は削除など戻せない操作 */
  variant?: Variant
  size?: 'medium' | 'small'
}

/** ボタン。`type` の既定は submit ではなく button */
export function Button({
  variant = 'secondary',
  size = 'medium',
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        variant !== 'secondary' && styles[variant],
        size === 'small' && styles.small,
        className,
      )}
      {...rest}
    />
  )
}

export interface IconButtonProps extends Omit<ButtonProps, 'aria-label'> {
  /** 文字のないボタンなので必須 */
  label: string
}

/** 記号だけの正方形のボタン。`label` は aria-label と title になる */
export function IconButton({ label, variant = 'ghost', className, ...rest }: IconButtonProps) {
  return (
    <Button
      variant={variant}
      aria-label={label}
      title={label}
      className={cx(styles.icon, className)}
      {...rest}
    />
  )
}

/** 削除用のゴミ箱アイコンのボタン。戻せない操作なので danger で出す */
export function RemoveButton(props: Omit<IconButtonProps, 'variant' | 'children'>) {
  return (
    <IconButton variant="danger" {...props}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={styles.glyph}
      >
        <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
      </svg>
    </IconButton>
  )
}
