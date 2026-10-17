import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react'
import { cx } from './cx'
import styles from './field.module.css'

interface FieldNoteProps {
  /** 欄の下に出す補足 */
  hint?: ReactNode
  /** 欄の下に朱で出す。hint より優先する */
  error?: ReactNode
}

interface FieldProps extends FieldNoteProps {
  label: string
  /** 名前をコントロールの左に置く。ツールバーの並びに入れるとき */
  inline?: boolean
  /**
   * コントロールを返す。受け取った属性をコントロールに付けると、hint と error が名前とは別の説明として読み上げられる
   */
  children(described: { 'aria-describedby'?: string }): ReactNode
}

/**
 * ラベル付きの欄。label が包むのは名前とコントロールだけで、hint と error は aria-describedby でつなぐ。
 * Input、Select、TextArea は label を受け取って自分で包むので、これを使うのは range など部品にないコントロールだけ
 */
export function Field({ label, hint, error, inline, children }: FieldProps) {
  const noteId = useId()
  return (
    <div className={cx(styles.field, inline && styles.inline)}>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: コントロールは children が返し、label の内側に入る */}
      <label className={styles.labelled}>
        <span className={styles.label}>{label}</span>
        {children({ 'aria-describedby': hint || error ? noteId : undefined })}
      </label>
      <FieldNote id={noteId} hint={hint} error={error} />
    </div>
  )
}

/** ボタンの並びなど、label で包めない内容を欄と同じ見た目で置く */
export function FieldGroup({
  label,
  hint,
  error,
  children,
}: FieldNoteProps & { label: string; children: ReactNode }) {
  const noteId = useId()
  return (
    // biome-ignore lint/a11y/useSemanticElements: fieldset の既定の枠と legend の配置を打ち消すより軽い
    <div
      className={styles.field}
      role="group"
      aria-label={label}
      aria-describedby={hint || error ? noteId : undefined}
    >
      <span className={styles.label}>{label}</span>
      <div className={styles.group}>{children}</div>
      <FieldNote id={noteId} hint={hint} error={error} />
    </div>
  )
}

function FieldNote({ id, hint, error }: FieldNoteProps & { id: string }) {
  if (error) {
    return (
      <span id={id} className={styles.error}>
        {error}
      </span>
    )
  }
  if (hint) {
    return (
      <span id={id} className={styles.hint}>
        {hint}
      </span>
    )
  }
  return null
}

/** Input、Select、TextArea の名前。名前のないコントロールを作れないよう、部品が label と組で出す */
interface LabelProps extends Omit<FieldProps, 'children'> {
  /**
   * 名前を画面に出さず、読み上げだけにする。並びの中で役目が見て分かるときに使う。
   * hint と error は出さない
   */
  hideLabel?: boolean
}

interface ControlA11y {
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

function Labeled({
  label,
  hideLabel,
  error,
  children,
  ...field
}: LabelProps & { children(a11y: ControlA11y): ReactNode }) {
  const invalid = error ? true : undefined
  if (hideLabel) return children({ 'aria-label': label, 'aria-invalid': invalid })
  return (
    <Field label={label} error={error} {...field}>
      {(described) => children({ ...described, 'aria-invalid': invalid })}
    </Field>
  )
}

export interface InputProps extends LabelProps, InputHTMLAttributes<HTMLInputElement> {}

export function Input({ label, hideLabel, hint, error, inline, className, ...rest }: InputProps) {
  return (
    <Labeled {...{ label, hideLabel, hint, error, inline }}>
      {(a11y) => <input className={cx(styles.control, className)} {...a11y} {...rest} />}
    </Labeled>
  )
}

export interface TextAreaProps extends LabelProps, TextareaHTMLAttributes<HTMLTextAreaElement> {}

export function TextArea({
  label,
  hideLabel,
  hint,
  error,
  inline,
  className,
  ...rest
}: TextAreaProps) {
  return (
    <Labeled {...{ label, hideLabel, hint, error, inline }}>
      {(a11y) => <textarea className={cx(styles.control, className)} {...a11y} {...rest} />}
    </Labeled>
  )
}

export interface SelectProps extends LabelProps, SelectHTMLAttributes<HTMLSelectElement> {}

export function Select({ label, hideLabel, hint, error, inline, className, ...rest }: SelectProps) {
  return (
    <Labeled {...{ label, hideLabel, hint, error, inline }}>
      {(a11y) => <select className={cx(styles.control, className)} {...a11y} {...rest} />}
    </Labeled>
  )
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
