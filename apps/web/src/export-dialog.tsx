import type { RenderOptions } from '@manga/render'
import { useEffect, useRef, useState } from 'react'

export type ExportOptions = Pick<RenderOptions, 'notes' | 'panelNumbers'>

/** 書き出しダイアログの既定。指示メモは印字せず、コマ番号も入れない */
const DEFAULT_EXPORT_OPTIONS: ExportOptions = { notes: 'none', panelNumbers: false }

// 'sheet' は PDF が別ページを作る指定で、renderPage では 'none' と同じなので出さない
const NOTES: readonly { value: ExportOptions['notes']; label: string }[] = [
  { value: 'none', label: '印字しない' },
  { value: 'margin', label: 'コマ横の余白に印字する' },
]

/**
 * 「このページを PNG で保存」のモーダル。開いている間だけマウントする。
 * 保存で `onExport` を呼ぶ。閉じる操作（キャンセル、Esc）は `onCancel`
 */
export function ExportDialog({
  onCancel,
  onExport,
}: {
  onCancel(): void
  onExport(opts: ExportOptions): void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [opts, setOpts] = useState(DEFAULT_EXPORT_OPTIONS)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog ref={ref} className="export-dialog" onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onExport(opts)
        }}
      >
        <h2>このページを PNG で保存</h2>
        <label className="in-field">
          <span className="in-label">指示メモ</span>
          <select
            value={opts.notes}
            onChange={(e) => setOpts({ ...opts, notes: e.target.value as ExportOptions['notes'] })}
          >
            {NOTES.map((n) => (
              <option key={n.value} value={n.value}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={opts.panelNumbers}
            onChange={(e) => setOpts({ ...opts, panelNumbers: e.target.checked })}
          />{' '}
          コマ番号を入れる
        </label>
        <p className="actions">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="submit">保存</button>
        </p>
      </form>
    </dialog>
  )
}
