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
