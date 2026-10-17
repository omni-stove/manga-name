import type { FocusKind } from '@manga/schema'
import { Field, Typography } from '@manga/ui'
import { SelectField, TextField } from './fields'
import styles from './hint-inspector.module.css'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { FocusInspectorProps } from './types'

export const FOCUS_KINDS: readonly { value: FocusKind; label: string }[] = [
  { value: 'face', label: '顔' },
  { value: 'keyObject', label: '物' },
  { value: 'sfx', label: '描き文字' },
]

export function FocusInspector({ focus, characters, diagnosis, onChange }: FocusInspectorProps) {
  return (
    <div className={section.section} data-inspector="focus">
      <Typography variant="subheading" className={section.title}>
        焦点 {focus.label}
      </Typography>
      <SelectField
        label="種別"
        value={focus.kind}
        options={FOCUS_KINDS}
        onCommit={(v) => v !== focus.kind && onChange(replace('/kind', v))}
      />
      <TextField
        label="ラベル"
        value={focus.label}
        onCommit={(v) => v !== focus.label && onChange(replace('/label', v))}
      />
      <Field label="重み" hint={focus.weight.toFixed(2)}>
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
        label="キャラクター"
        value={focus.characterId ?? ''}
        options={[
          { value: '', label: '（なし）' },
          ...characters.map((c) => ({ value: c.id, label: c.name })),
        ]}
        onCommit={(v) => onChange(optionalString('/characterId', focus.characterId, v))}
      />
      {diagnosis && (
        <dl className={styles.diagnosis} data-diagnosis-status={diagnosis.status}>
          <dt>t</dt>
          <dd>{diagnosis.t.toFixed(2)}</dd>
          <dt>誘導線</dt>
          <dd>
            強 {diagnosis.strong} / 弱 {diagnosis.weak}
          </dd>
          <dt>判定</dt>
          <dd data-status={diagnosis.status}>{diagnosis.status}</dd>
          {diagnosis.reason && (
            <>
              <dt>理由</dt>
              <dd>{diagnosis.reason}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}
