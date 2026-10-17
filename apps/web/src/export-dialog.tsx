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
}

type Range = 'current' | 'all' | 'custom'
/** JSON はページを描かずプロジェクトをそのまま書くので、ExportFormat とは分ける */
type Format = ExportFormat | 'json'

const FORMATS: readonly { value: Format; label: string }[] = [
  { value: 'png', label: 'PNG（複数ページは zip）' },
  { value: 'pdf', label: 'PDF' },
  { value: 'json', label: 'JSON（プロジェクトのデータ。画像は含まない）' },
]

const RANGES: readonly { value: Range; label: string }[] = [
  { value: 'current', label: 'このページ' },
  { value: 'all', label: 'エピソードの全ページ' },
  { value: 'custom', label: 'ページを指定' },
]

const NOTES: readonly { value: RenderOptions['notes']; label: string; pdfOnly?: boolean }[] = [
  { value: 'none', label: '印字しない' },
  { value: 'margin', label: 'コマ横の余白に印字する' },
  { value: 'sheet', label: '各ページの後ろに一覧ページを足す', pdfOnly: true },
]

/**
 * 書き出しのモーダル。形式（PNG / PDF / JSON）を選び、PNG と PDF ではページ範囲、指示メモ、コマ番号、見開き、dpi も選ぶ。
 * 範囲に採用中の絵が無いコマがあれば警告するが、書き出しは止めない。
 * 開いている間だけマウントする。書き出すで PNG / PDF なら `onExport`、JSON なら `onExportProject`、
 * 閉じる操作（キャンセル、Esc）で `onCancel`
 */
export function ExportDialog({
  pages,
  currentIndex,
  dpi,
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

  const [from, to] =
    range === 'current'
      ? [currentIndex + 1, currentIndex + 1]
      : range === 'all'
        ? [1, pages.length]
        : [custom.from, custom.to]
  const rangeError =
    Number.isInteger(from) && Number.isInteger(to) && from >= 1 && from <= to && to <= pages.length
      ? undefined
      : `1〜${pages.length} の範囲で、始まりを終わり以下にしてください`
  const dpiValue = Number(dpiText)
  const dpiError =
    Number.isInteger(dpiValue) && dpiValue >= 72 && dpiValue <= 1200
      ? undefined
      : '72〜1200 の整数にしてください'
  const rendersPages = format !== 'json'
  const missing = !rendersPages || rangeError ? 0 : countMissingArts(pages.slice(from - 1, to))
  const effectiveNotes = format === 'png' && notes === 'sheet' ? 'none' : notes

  const submit = () => {
    if (format === 'json') return onExportProject()
    if (rangeError || dpiError) return
    onExport({
      format,
      from,
      to,
      notes: effectiveNotes,
      panelNumbers,
      spread: format === 'pdf' && spread,
      dpi: dpiValue,
    })
  }

  return (
    <Dialog
      title="書き出し"
      onClose={onCancel}
      onSubmit={submit}
      actions={
        <>
          <Button onClick={onCancel}>キャンセル</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={rendersPages && (!!rangeError || !!dpiError)}
          >
            書き出す
          </Button>
        </>
      }
    >
      <Select label="形式" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
        {FORMATS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </Select>
      {rendersPages && (
        <>
          <Select label="範囲" value={range} onChange={(e) => setRange(e.target.value as Range)}>
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          {range === 'custom' && (
            <FieldGroup label="ページ" error={rangeError}>
              <Input
                type="number"
                label="開始ページ"
                hideLabel
                min={1}
                max={pages.length}
                value={custom.from}
                onChange={(e) => setCustom({ ...custom, from: e.target.valueAsNumber })}
              />
              〜
              <Input
                type="number"
                label="終了ページ"
                hideLabel
                min={1}
                max={pages.length}
                value={custom.to}
                onChange={(e) => setCustom({ ...custom, to: e.target.valueAsNumber })}
              />
            </FieldGroup>
          )}
          <Select
            label="指示メモ"
            value={effectiveNotes}
            onChange={(e) => setNotes(e.target.value as RenderOptions['notes'])}
          >
            {NOTES.filter((n) => format === 'pdf' || !n.pdfOnly).map((n) => (
              <option key={n.value} value={n.value}>
                {n.label}
              </option>
            ))}
          </Select>
          <Checkbox
            label="コマ番号を入れる"
            checked={panelNumbers}
            onChange={(e) => setPanelNumbers(e.target.checked)}
          />
          {format === 'pdf' && (
            <Checkbox
              label="見開きでまとめる"
              checked={spread}
              onChange={(e) => setSpread(e.target.checked)}
            />
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
        <Typography role="status">
          未生成のコマが {missing} 個あります。枠だけのまま書き出します。
        </Typography>
      )}
    </Dialog>
  )
}
