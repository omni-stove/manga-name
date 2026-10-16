import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cx } from './cx'
import styles from './field.module.css'

interface FieldProps {
  label: string
  /** 欄の下に出す補足 */
  hint?: ReactNode
  /** 欄の下に朱で出す。hint より優先する */
  error?: ReactNode
  children: ReactNode
}

/** ラベル付きの欄。コントロールは children として label の内側に置く */
export function Field({ label, hint, error, children }: FieldProps) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: コントロールは children として渡され、label の内側に入る
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
      <FieldNote hint={hint} error={error} />
    </label>
  )
}

/** ボタンの並びなど、label で包めない内容を欄と同じ見た目で置く */
export function FieldGroup({ label, hint, error, children }: FieldProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: fieldset の既定の枠と legend の配置を打ち消すより軽い
    <div className={styles.field} role="group" aria-label={label}>
      <span className={styles.label}>{label}</span>
      <div className={styles.group}>{children}</div>
      <FieldNote hint={hint} error={error} />
    </div>
  )
}

function FieldNote({ hint, error }: { hint?: ReactNode; error?: ReactNode }) {
  if (error) return <span className={styles.error}>{error}</span>
  if (hint) return <span className={styles.hint}>{hint}</span>
  return null
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(styles.control, className)} {...rest} />
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(styles.control, className)} {...rest} />
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(styles.control, className)} {...rest} />
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
}

/** 右にラベルを置いたチェックボックス */
export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx(styles.checkbox, className)}>
      <input type="checkbox" {...rest} />
      {label}
    </label>
  )
}
