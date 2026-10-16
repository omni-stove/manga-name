import { ProjectSettingsSchema, type ReadingDirection } from '@manga/schema'
import { NumberField, SelectField, TextField } from './fields'
import { optionalString, replace } from './patch'
import type { ProjectSettingsInspectorProps } from './types'

const DIRECTIONS: readonly { value: ReadingDirection; label: string }[] = [
  { value: 'rtl', label: '右から左（rtl）' },
  { value: 'ltr', label: '左から右（ltr）' },
]

const { pageSize, dpi } = ProjectSettingsSchema.shape
const isLength = (n: number) => pageSize.shape.w.safeParse(n).success
const isDpi = (n: number) => dpi.safeParse(n).success

export function ProjectSettingsInspector({ settings, onChange }: ProjectSettingsInspectorProps) {
  return (
    <div className="inspector-section" data-inspector="settings">
      <h3>プロジェクト設定</h3>
      <SelectField
        label="読む方向"
        value={settings.direction}
        options={DIRECTIONS}
        onCommit={(v) => onChange(replace('/direction', v))}
      />
      <NumberField
        label="幅（mm）"
        value={settings.pageSize.w}
        min={1}
        step="any"
        isValid={isLength}
        onCommit={(n) => onChange(replace('/pageSize/w', n))}
      />
      <NumberField
        label="高さ（mm）"
        value={settings.pageSize.h}
        min={1}
        step="any"
        isValid={isLength}
        onCommit={(n) => onChange(replace('/pageSize/h', n))}
      />
      <NumberField
        label="dpi"
        value={settings.dpi}
        min={1}
        step={1}
        isValid={isDpi}
        onCommit={(n) => onChange(replace('/dpi', n))}
      />
      <TextField
        label="スタイル"
        value={settings.style.prompt}
        onCommit={(v) => v !== settings.style.prompt && onChange(replace('/style/prompt', v))}
      />
      <TextField
        label="除外するもの"
        value={settings.style.negative ?? ''}
        onCommit={(v) => onChange(optionalString('/style/negative', settings.style.negative, v))}
      />
    </div>
  )
}
