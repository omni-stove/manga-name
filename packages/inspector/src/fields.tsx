import { FieldGroup, Input, Select, TextArea } from '@manga/ui'
import type { ReactNode } from 'react'
import { useDraft } from './use-draft'

/** text / note / appearance の複数行欄が Patch を出すまでの待ち */
export const DEBOUNCE_MS = 300

interface TextFieldProps {
  label: string
  value: string
  /** あれば複数行欄 */
  rows?: number
  /** 省略すると入力のたびに commit する */
  delayMs?: number
  /** 空白だけの値を不正にする */
  required?: boolean
  placeholder?: string
  onCommit(value: string): void
}

/** 文字列欄。不正な値は `aria-invalid` を付けて commit しない */
export function TextField({
  label,
  value,
  rows,
  delayMs = 0,
  required = false,
  placeholder,
  onCommit,
}: TextFieldProps) {
  const isValid = (text: string) => !required || text.trim() !== ''
  const { draft, set, flush } = useDraft(
    value,
    (next) => {
      if (isValid(next)) onCommit(next)
    },
    delayMs,
  )
  const invalid = !isValid(draft)
  return rows === undefined ? (
    <Input
      label={label}
      value={draft}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onChange={(e) => set(e.target.value)}
      onBlur={flush}
    />
  ) : (
    <TextArea
      label={label}
      value={draft}
      rows={rows}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onChange={(e) => set(e.target.value)}
      onBlur={flush}
    />
  )
}

interface NumberFieldProps {
  label: string
  value: number
  min?: number
  step?: number | 'any'
  /** スキーマの検証。通らない値は commit しない */
  isValid(value: number): boolean
  /** 途中の値で Patch を出したくない欄（読み順の入れ替え）は blur か Enter で commit する */
  commitOnBlur?: boolean
  onCommit(value: number): void
}

/** 数値欄。既定では入力のたびに commit する。数にならない値や `isValid` を通らない値は `aria-invalid` */
export function NumberField({
  label,
  value,
  min,
  step,
  isValid,
  commitOnBlur = false,
  onCommit,
}: NumberFieldProps) {
  const parse = (text: string) => (text.trim() === '' ? Number.NaN : Number(text))
  const { draft, set, flush } = useDraft(
    String(value),
    (text) => {
      const n = parse(text)
      if (Number.isFinite(n) && isValid(n)) onCommit(n)
    },
    commitOnBlur ? null : 0,
  )
  const n = parse(draft)
  const invalid = !Number.isFinite(n) || !isValid(n)
  return (
    <Input
      label={label}
      type="number"
      value={draft}
      min={min}
      step={step}
      aria-invalid={invalid || undefined}
      onChange={(e) => set(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') flush()
      }}
    />
  )
}

/** 選択肢。`label` は読むたびに `label()` を呼ぶので、モジュールの定数にしても表示時の言語で出る */
export const option = <T extends string>(value: T, label: () => string) => ({
  value,
  get label() {
    return label()
  },
})

interface SelectFieldProps<T extends string> {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onCommit(value: T): void
}

/** 選択欄。選ぶたびに commit する */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onCommit,
}: SelectFieldProps<T>) {
  return (
    <Select label={label} value={value} onChange={(e) => onCommit(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  )
}

/** ボタンなど、label で包めない内容を欄と同じ並びに置く */
export function Group({ label, children }: { label: string; children: ReactNode }) {
  return <FieldGroup label={label}>{children}</FieldGroup>
}
