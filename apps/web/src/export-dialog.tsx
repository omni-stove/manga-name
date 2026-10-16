import type { RenderOptions } from '@manga/render'
import { Button, Checkbox, Dialog, Field, Select } from '@manga/ui'
import { useState } from 'react'

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
  const [opts, setOpts] = useState(DEFAULT_EXPORT_OPTIONS)
  return (
    <Dialog
      title="このページを PNG で保存"
      onClose={onCancel}
      onSubmit={() => onExport(opts)}
      actions={
        <>
          <Button onClick={onCancel}>キャンセル</Button>
          <Button type="submit" variant="primary">
            保存
          </Button>
        </>
      }
    >
      <Field label="指示メモ">
        <Select
          value={opts.notes}
          onChange={(e) => setOpts({ ...opts, notes: e.target.value as ExportOptions['notes'] })}
        >
          {NOTES.map((n) => (
            <option key={n.value} value={n.value}>
              {n.label}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox
        label="コマ番号を入れる"
        checked={opts.panelNumbers}
        onChange={(e) => setOpts({ ...opts, panelNumbers: e.target.checked })}
      />
    </Dialog>
  )
}
