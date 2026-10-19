import { m } from '@manga/i18n'
import type { Vector } from '@manga/schema'
import { Typography } from '@manga/ui'
import { option, SelectField } from './fields'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { VectorInspectorProps } from './types'

const KINDS: readonly { value: Vector['kind']; label: string }[] = [
  option('gaze', m.vector_kind_gaze),
  option('motion', m.vector_kind_motion),
  option('speed', m.vector_kind_speed),
]

const STRENGTHS: readonly { value: Vector['strength']; label: string }[] = [
  option('strong', m.vector_strength_strong),
  option('weak', m.vector_strength_weak),
]

export function VectorInspector({ vector, targets, onChange }: VectorInspectorProps) {
  const options = [{ value: '', label: m.inspector_vector_nearest_focus() }, ...targets]
  // 指し先が消えた古い値でもセレクトが空欄にならないよう、選択肢に残す
  if (vector.targetFocusId && !targets.some((t) => t.value === vector.targetFocusId)) {
    options.push({ value: vector.targetFocusId, label: vector.targetFocusId })
  }
  return (
    <div className={section.section} data-inspector="vector">
      <Typography variant="subheading" className={section.title}>
        {m.vector()}
      </Typography>
      <SelectField
        label={m.vector_kind()}
        value={vector.kind}
        options={KINDS}
        onCommit={(v) => v !== vector.kind && onChange(replace('/kind', v))}
      />
      <SelectField
        label={m.vector_strength()}
        value={vector.strength}
        options={STRENGTHS}
        onCommit={(v) => v !== vector.strength && onChange(replace('/strength', v))}
      />
      <SelectField
        label={m.vector_target_focus()}
        value={vector.targetFocusId ?? ''}
        options={options}
        onCommit={(v) => onChange(optionalString('/targetFocusId', vector.targetFocusId, v))}
      />
    </div>
  )
}
