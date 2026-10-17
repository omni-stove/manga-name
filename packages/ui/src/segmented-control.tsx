import { useId } from 'react'
import styles from './segmented-control.module.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
  /** 選ぶキー。ラベルの横に出し、aria-keyshortcuts にする。キーを受けるのは使う側 */
  shortcut?: string
}

interface SegmentedControlProps<T extends string> {
  /** 読み上げ用の名前。画面には出さない */
  label: string
  value: T
  options: readonly SegmentedOption<T>[]
  onChange(value: T): void
}

/** 1 つだけ選ぶ切り替え。中身は radio なので矢印キーで選び直せる */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  const name = useId()
  return (
    <fieldset className={styles.root} aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className={styles.option}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
            aria-keyshortcuts={o.shortcut}
          />
          <span>{o.label}</span>
          {o.shortcut && (
            <kbd className={styles.key} aria-hidden>
              {o.shortcut.toUpperCase()}
            </kbd>
          )}
        </label>
      ))}
    </fieldset>
  )
}
