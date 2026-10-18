import { type DragEvent, type ReactNode, useId, useRef, useState } from 'react'
import { IconButton } from './button'
import buttonStyles from './button.module.css'
import { cx } from './cx'
import fieldStyles from './field.module.css'
import styles from './file-drop.module.css'

export interface FileDropProps {
  label: string
  /** input の accept。ドロップしたファイルにも同じ条件を当てる */
  accept?: string
  /** フォームの値にするときの名前。選んだファイルは input に残り、名前と解除のボタンを出す */
  name?: string
  /**
   * 選ぶかドロップするたびに呼ぶ。渡すとファイルは input に残さず、同じファイルを続けて選べる。
   * フォームの値にせず、選んだらすぐ読み込むとき
   */
  onPick?(file: File): void
  disabled?: boolean
  /** 枠の中に出す案内。既定は「ここにドロップ」 */
  prompt?: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

/**
 * ファイルを選ぶボタンとドロップ先を兼ねた欄。素の input は見えなくし、枠全体を押すと選ぶダイアログが開く。
 * input の名前は label で付くので、`getByLabel(label)` でその input が取れる
 */
export function FileDrop({
  label,
  accept,
  name,
  onPick,
  disabled,
  prompt = 'ここにドロップ',
  hint,
  error,
}: FileDropProps) {
  const labelId = useId()
  const noteId = useId()
  const ref = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState(false)

  const take = (file: File) => {
    setRejected(false)
    if (onPick) {
      onPick(file)
      return
    }
    setFileName(file.name)
  }

  const clear = () => {
    if (ref.current) ref.current.value = ''
    setFileName(undefined)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const input = ref.current
    const file = e.dataTransfer.files[0]
    if (!input || !file || input.disabled) return
    if (!matchesAccept(file, accept)) {
      setRejected(true)
      return
    }
    if (!onPick) {
      // フォームの値として送れるよう、ドロップしたファイルを input に入れる
      const transfer = new DataTransfer()
      transfer.items.add(file)
      input.files = transfer.files
    }
    take(file)
  }

  const note = error ?? (rejected ? 'この形式のファイルは選べません' : undefined)
  return (
    <div className={fieldStyles.field}>
      <span id={labelId} className={fieldStyles.label}>
        {label}
      </span>
      <div className={styles.row}>
        <label
          className={styles.zone}
          data-dragging={dragging}
          data-invalid={note ? true : undefined}
          onDragOver={(e) => {
            e.preventDefault()
            if (!ref.current?.disabled) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={ref}
            type="file"
            className={styles.input}
            accept={accept}
            name={name}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-describedby={note || hint ? noteId : undefined}
            aria-invalid={note ? true : undefined}
            onChange={(e) => {
              const input = e.currentTarget
              const file = input.files?.[0]
              // onPick のときは、同じファイルを選び直しても change が起きるよう空にする
              if (onPick) input.value = ''
              if (file) take(file)
              else clear()
            }}
          />
          <span className={cx(buttonStyles.button, buttonStyles.small)} aria-hidden>
            ファイルを選ぶ
          </span>
          <span className={cx(styles.text, fileName && styles.fileName)}>{fileName ?? prompt}</span>
        </label>
        {fileName && (
          <IconButton label="選択を解除" size="small" disabled={disabled} onClick={clear}>
            ×
          </IconButton>
        )}
      </div>
      {note ? (
        <span id={noteId} className={fieldStyles.error}>
          {note}
        </span>
      ) : (
        hint && (
          <span id={noteId} className={fieldStyles.hint}>
            {hint}
          </span>
        )
      )}
    </div>
  )
}

/**
 * input の accept と同じ規則（MIME、`type/*`、拡張子）で、ファイルが選べるかを返す。
 * ドロップした File は MIME が空のことがあるので、その場合は弾かず受け取り側の判定に任せる
 */
function matchesAccept(file: File, accept: string | undefined): boolean {
  if (!accept || file.type === '') return true
  const fileName = file.name.toLowerCase()
  return accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .some((token) =>
      token.startsWith('.')
        ? fileName.endsWith(token)
        : token.endsWith('/*')
          ? file.type.startsWith(token.slice(0, -1))
          : file.type === token,
    )
}
