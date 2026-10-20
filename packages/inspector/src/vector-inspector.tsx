// @vitest-environment jsdom
import { m } from '@manga/i18n'
import type { Patch, Vector } from '@manga/schema'
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

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { choose, must, render, samplePanel, selectLabelled } = await import('./dom-harness')

  describe('VectorInspector', () => {
    const vector = must(samplePanel.vectors.find((v) => v.targetFocusId))
    const targets = samplePanel.focusPoints.map((f) => ({ value: f.id, label: f.label }))

    test('kind and strength replace, and the target can be cleared to the nearest focus', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const { container } = await render(
        <VectorInspector vector={vector} targets={targets} onChange={onChange} />,
      )
      await choose(selectLabelled(container, m.vector_kind()), 'speed')
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/kind', value: 'speed' }])
      await choose(selectLabelled(container, m.vector_strength()), 'weak')
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'replace', path: '/strength', value: 'weak' },
      ])

      const target = selectLabelled(container, m.vector_target_focus())
      expect([...target.options].map((o) => o.value)).toEqual(['', ...targets.map((t) => t.value)])
      await choose(target, '')
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/targetFocusId' }])
    })

    test('a target that is no longer in targets stays selectable', async () => {
      const { container } = await render(
        <VectorInspector
          vector={{ ...vector, targetFocusId: 'fp_gone' }}
          targets={targets}
          onChange={() => {}}
        />,
      )
      const target = selectLabelled(container, m.vector_target_focus())
      expect(target.value).toBe('fp_gone')
      expect([...target.options].at(-1)?.textContent).toBe('fp_gone')
    })
  })
}
