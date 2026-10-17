import type { Vector } from '@manga/schema'
import { Typography } from '@manga/ui'
import { SelectField } from './fields'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { VectorInspectorProps } from './types'

const KINDS: readonly { value: Vector['kind']; label: string }[] = [
  { value: 'gaze', label: '視線' },
  { value: 'motion', label: '動き' },
  { value: 'speed', label: '効果線' },
]

const STRENGTHS: readonly { value: Vector['strength']; label: string }[] = [
  { value: 'strong', label: '強' },
  { value: 'weak', label: '弱' },
]

export function VectorInspector({ vector, targets, onChange }: VectorInspectorProps) {
  const options = [{ value: '', label: '（最も近い焦点）' }, ...targets]
  // 指し先が消えた古い値でもセレクトが空欄にならないよう、選択肢に残す
  if (vector.targetFocusId && !targets.some((t) => t.value === vector.targetFocusId)) {
    options.push({ value: vector.targetFocusId, label: vector.targetFocusId })
  }
  return (
    <div className={section.section} data-inspector="vector">
      <Typography variant="subheading" className={section.title}>
        ベクトル
      </Typography>
      <SelectField
        label="種別"
        value={vector.kind}
        options={KINDS}
        onCommit={(v) => v !== vector.kind && onChange(replace('/kind', v))}
      />
      <SelectField
        label="強さ"
        value={vector.strength}
        options={STRENGTHS}
        onCommit={(v) => v !== vector.strength && onChange(replace('/strength', v))}
      />
      <SelectField
        label="指す焦点"
        value={vector.targetFocusId ?? ''}
        options={options}
        onCommit={(v) => onChange(optionalString('/targetFocusId', vector.targetFocusId, v))}
      />
    </div>
  )
}
