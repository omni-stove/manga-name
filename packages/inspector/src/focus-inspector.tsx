import { m } from '@manga/i18n'
import type { FocusKind } from '@manga/schema'
import { Field, Typography } from '@manga/ui'
import { option, SelectField, TextField } from './fields'
import styles from './hint-inspector.module.css'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { FocusInspectorProps } from './types'

export const FOCUS_KINDS: readonly { value: FocusKind; label: string }[] = [
  option('face', m.inspector_focus_kind_face),
  option('keyObject', m.inspector_focus_kind_key_object),
  option('sfx', m.inspector_focus_kind_sfx),
]

export function FocusInspector({ focus, characters, diagnosis, onChange }: FocusInspectorProps) {
  return (
    <div className={section.section} data-inspector="focus">
      <Typography variant="subheading" className={section.title}>
        {m.inspector_focus_title({ label: focus.label })}
      </Typography>
      <SelectField
        label={m.inspector_kind()}
        value={focus.kind}
        options={FOCUS_KINDS}
        onCommit={(v) => v !== focus.kind && onChange(replace('/kind', v))}
      />
      <TextField
        label={m.inspector_focus_label()}
        value={focus.label}
        onCommit={(v) => v !== focus.label && onChange(replace('/label', v))}
      />
      <Field label={m.inspector_focus_weight()} hint={focus.weight.toFixed(2)}>
        {(described) => (
          <input
            type="range"
            className={styles.slider}
            min={0}
            max={1}
            step={0.05}
            value={focus.weight}
            onChange={(e) => onChange(replace('/weight', Number(e.target.value)))}
            {...described}
          />
        )}
      </Field>
      <SelectField
        label={m.inspector_focus_character()}
        value={focus.characterId ?? ''}
        options={[
          { value: '', label: m.inspector_none() },
          ...characters.map((c) => ({ value: c.id, label: c.name })),
        ]}
        onCommit={(v) => onChange(optionalString('/characterId', focus.characterId, v))}
      />
      {diagnosis && (
        <dl className={styles.diagnosis} data-diagnosis-status={diagnosis.status}>
          <dt>t</dt>
          <dd>{diagnosis.t.toFixed(2)}</dd>
          <dt>{m.inspector_vector_lines()}</dt>
          <dd>
            {m.inspector_focus_vector_counts({
              strong: diagnosis.strong,
              weak: diagnosis.weak,
            })}
          </dd>
          <dt>{m.inspector_focus_status()}</dt>
          <dd data-status={diagnosis.status}>{diagnosis.status}</dd>
          {diagnosis.reason && (
            <>
              <dt>{m.inspector_focus_reason()}</dt>
              <dd>{diagnosis.reason}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}
