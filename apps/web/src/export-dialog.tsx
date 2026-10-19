import { m } from '@manga/i18n'
import type { RenderOptions } from '@manga/render'
import type { Page } from '@manga/schema'
import { Button, Checkbox, Dialog, FieldGroup, Input, Select, Typography } from '@manga/ui'
import { useState } from 'react'
import { countMissingArts, type ExportFormat } from './export-page-job'

export interface ExportSettings {
  format: ExportFormat
  /** 書き出すページの範囲。エピソード内の 1 始まりで、両端を含む */
  from: number
  to: number
  notes: RenderOptions['notes']
  panelNumbers: boolean
  /** PDF だけ。見開きで 1 枚にまとめる */
  spread: boolean
  dpi: number
  /** PNG だけ。zip にまとめず、書き出し先フォルダへページごとに上書きで書く */
  toFolder: boolean
}

/** Desktop の書き出し先フォルダ。`path` は覚えているフォルダで、選んだことが無ければ null */
interface ExportFolder {
  path: string | null
  onChoose(): void
}

type Range = 'current' | 'all' | 'custom'
/** JSON はページを描かずプロジェクトをそのまま書くので、ExportFormat とは分ける */
type Format = ExportFormat | 'json'

const formatOptions = (): readonly { value: Format; label: string }[] => [
  { value: 'png', label: m.web_export_format_png() },
  { value: 'pdf', label: 'PDF' },
  { value: 'json', label: m.web_export_format_json() },
]

const rangeOptions = (): readonly { value: Range; label: string }[] => [
  { value: 'current', label: m.web_export_range_current() },
  { value: 'all', label: m.web_export_range_all() },
  { value: 'custom', label: m.web_export_range_custom() },
]

const noteOptions = (): readonly {
  value: RenderOptions['notes']
  label: string
  pdfOnly?: boolean
}[] => [
  { value: 'none', label: m.web_export_notes_none() },
  { value: 'margin', label: m.web_export_notes_margin() },
  { value: 'sheet', label: m.web_export_notes_sheet(), pdfOnly: true },
]

/**
 * 書き出しのモーダル。形式（PNG / PDF / JSON）を選び、PNG と PDF ではページ範囲、指示メモ、コマ番号、見開き、dpi も選ぶ。
 * `folder` を渡すと（Desktop）、PNG で「フォルダへ書き出す」を選べ、書き出し先フォルダを表示して選び直せる。
 * フォルダが選ばれるまでは書き出せない。
 * 範囲に採用中の絵が無いコマがあれば警告するが、書き出しは止めない。
 * 開いている間だけマウントする。書き出すで PNG / PDF なら `onExport`、JSON なら `onExportProject`、
 * 閉じる操作（キャンセル、Esc）で `onCancel`
 */
export function ExportDialog({
  pages,
  currentIndex,
  dpi,
  folder,
  onCancel,
  onExport,
  onExportProject,
}: {
  /** 開いているページのエピソードのページ */
  pages: readonly Page[]
  /** 開いているページの添字 */
  currentIndex: number
  /** プロジェクト設定の dpi。dpi 欄の既定 */
  dpi: number
  /** Web では渡さない */
  folder?: ExportFolder
  onCancel(): void
  onExport(settings: ExportSettings): void
  onExportProject(): void
}) {
  const [format, setFormat] = useState<Format>('png')
  const [range, setRange] = useState<Range>('current')
  const [custom, setCustom] = useState({ from: currentIndex + 1, to: currentIndex + 1 })
  const [notes, setNotes] = useState<RenderOptions['notes']>('none')
  const [panelNumbers, setPanelNumbers] = useState(false)
  const [spread, setSpread] = useState(false)
  const [dpiText, setDpiText] = useState(String(dpi))
  const [toFolder, setToFolder] = useState(false)

  const [from, to] =
    range === 'current'
      ? [currentIndex + 1, currentIndex + 1]
      : range === 'all'
        ? [1, pages.length]
        : [custom.from, custom.to]
  const rangeError =
    Number.isInteger(from) && Number.isInteger(to) && from >= 1 && from <= to && to <= pages.length
      ? undefined
      : m.web_export_range_error({ max: pages.length })
  const dpiValue = Number(dpiText)
  const dpiError =
    Number.isInteger(dpiValue) && dpiValue >= 72 && dpiValue <= 1200
      ? undefined
      : m.web_export_dpi_error()
  const rendersPages = format !== 'json'
  const missing = !rendersPages || rangeError ? 0 : countMissingArts(pages.slice(from - 1, to))
  const effectiveNotes = format === 'png' && notes === 'sheet' ? 'none' : notes
  const effectiveToFolder = format === 'png' && folder !== undefined && toFolder
  const folderError = effectiveToFolder && !folder?.path ? m.web_export_folder_missing() : undefined

  const submit = () => {
    if (format === 'json') return onExportProject()
    if (rangeError || dpiError || folderError) return
    onExport({
      format,
      from,
      to,
      notes: effectiveNotes,
      panelNumbers,
      spread: format === 'pdf' && spread,
      dpi: dpiValue,
      toFolder: effectiveToFolder,
    })
  }

  return (
    <Dialog
      title={m.web_export_title()}
      onClose={onCancel}
      onSubmit={submit}
      actions={
        <>
          <Button onClick={onCancel}>{m.cancel()}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={rendersPages && (!!rangeError || !!dpiError || !!folderError)}
          >
            {m.web_export_submit()}
          </Button>
        </>
      }
    >
      <Select
        label={m.web_export_format()}
        value={format}
        onChange={(e) => setFormat(e.target.value as Format)}
      >
        {formatOptions().map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </Select>
      {rendersPages && (
        <>
          <Select
            label={m.web_export_range()}
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
          >
            {rangeOptions().map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          {range === 'custom' && (
            <FieldGroup label={m.web_export_pages()} error={rangeError}>
              <Input
                type="number"
                label={m.web_export_from_page()}
                hideLabel
                min={1}
                max={pages.length}
                value={custom.from}
                onChange={(e) => setCustom({ ...custom, from: e.target.valueAsNumber })}
              />
              〜
              <Input
                type="number"
                label={m.web_export_to_page()}
                hideLabel
                min={1}
                max={pages.length}
                value={custom.to}
                onChange={(e) => setCustom({ ...custom, to: e.target.valueAsNumber })}
              />
            </FieldGroup>
          )}
          <Select
            label={m.panel_note()}
            value={effectiveNotes}
            onChange={(e) => setNotes(e.target.value as RenderOptions['notes'])}
          >
            {noteOptions()
              .filter((n) => format === 'pdf' || !n.pdfOnly)
              .map((n) => (
                <option key={n.value} value={n.value}>
                  {n.label}
                </option>
              ))}
          </Select>
          <Checkbox
            label={m.web_export_panel_numbers()}
            checked={panelNumbers}
            onChange={(e) => setPanelNumbers(e.target.checked)}
          />
          {format === 'pdf' && (
            <Checkbox
              label={m.web_export_spread()}
              checked={spread}
              onChange={(e) => setSpread(e.target.checked)}
            />
          )}
          {format === 'png' && folder && (
            <Checkbox
              label={m.web_export_to_folder()}
              checked={toFolder}
              onChange={(e) => setToFolder(e.target.checked)}
            />
          )}
          {effectiveToFolder && folder && (
            <FieldGroup label={m.web_export_folder()} error={folderError}>
              {folder.path && <Typography as="span">{folder.path}</Typography>}
              <Button size="small" onClick={folder.onChoose}>
                {m.web_export_choose_folder()}
              </Button>
            </FieldGroup>
          )}
          <Input
            label="dpi"
            error={dpiError}
            type="number"
            min={72}
            max={1200}
            value={dpiText}
            onChange={(e) => setDpiText(e.target.value)}
          />
        </>
      )}
      {missing > 0 && (
        <Typography role="status">{m.web_export_missing_arts({ count: missing })}</Typography>
      )}
    </Dialog>
  )
}
