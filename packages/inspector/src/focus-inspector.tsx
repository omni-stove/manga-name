// @vitest-environment jsdom
import { m } from '@manga/i18n'
import type { FocusKind, FocusStatus, Patch } from '@manga/schema'
import { Field, Typography } from '@manga/ui'
import { option, SelectField, TextField } from './fields'
import styles from './hint-inspector.module.css'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { FocusInspectorProps } from './types'

export const FOCUS_KINDS: readonly { value: FocusKind; label: string }[] = [
  option('face', m.focus_point_kind_face),
  option('keyObject', m.focus_point_kind_key_object),
  option('sfx', m.focus_point_kind_sfx),
]

const STATUS_LABELS: Record<FocusStatus, () => string> = {
  ok: m.focus_status_ok,
  weak: m.focus_status_weak,
  miss: m.focus_status_miss,
}

export function FocusInspector({ focus, characters, diagnosis, onChange }: FocusInspectorProps) {
  return (
    <div className={section.section} data-inspector="focus">
      <Typography variant="subheading" className={section.title}>
        {m.inspector_focus_title({ label: focus.label })}
      </Typography>
      <SelectField
        label={m.focus_point_kind()}
        value={focus.kind}
        options={FOCUS_KINDS}
        onCommit={(v) => v !== focus.kind && onChange(replace('/kind', v))}
      />
      <TextField
        label={m.focus_point_label()}
        value={focus.label}
        onCommit={(v) => v !== focus.label && onChange(replace('/label', v))}
      />
      <Field label={m.focus_point_weight()} hint={focus.weight.toFixed(2)}>
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
        label={m.character()}
        value={focus.characterId ?? ''}
        options={[
          { value: '', label: m.none() },
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
          <dd data-status={diagnosis.status}>{STATUS_LABELS[diagnosis.status]()}</dd>
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

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { act } = await import('react')
  const { choose, inputLabelled, must, project, render, samplePanel, selectLabelled, setValue } =
    await import('./dom-harness')

  describe('FocusInspector', () => {
    const focus = must(samplePanel.focusPoints.find((f) => f.characterId))

    test('kind, label, weight and character each emit their own patch', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const { container } = await render(
        <FocusInspector focus={focus} characters={project.characters} onChange={onChange} />,
      )
      await choose(selectLabelled(container, m.focus_point_kind()), 'sfx')
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/kind', value: 'sfx' }])

      await act(async () => setValue(inputLabelled(container, m.focus_point_label()), 'E'))
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/label', value: 'E' }])

      const weight = must(container.querySelector<HTMLInputElement>('input[type="range"]'))
      const hintId = must(weight.getAttribute('aria-describedby'))
      expect(must(document.getElementById(hintId)).textContent).toBe(focus.weight.toFixed(2))
      await act(async () => setValue(weight, '0.75'))
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'replace', path: '/weight', value: 0.75 }])

      const character = selectLabelled(container, m.character())
      expect(character.value).toBe(focus.characterId)
      await choose(character, '')
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/characterId' }])
    })

    test('assigns a character to a focus without one', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const { characterId: _, ...plain } = focus
      const { container } = await render(
        <FocusInspector focus={plain} characters={project.characters} onChange={onChange} />,
      )
      const select = selectLabelled(container, m.character())
      expect(select.value).toBe('')
      await choose(select, 'chr_e')
      expect(onChange).toHaveBeenCalledWith([{ op: 'add', path: '/characterId', value: 'chr_e' }])
    })

    test('shows the focus diagnosis with its status and reason only when given', async () => {
      const props = { focus, characters: project.characters, onChange: () => {} }
      const { container, root } = await render(<FocusInspector {...props} />)
      expect(container.querySelector('dl')).toBeNull()

      const diagnosis = {
        focusPointId: focus.id,
        kind: focus.kind,
        panelId: samplePanel.id,
        t: 0.4567,
        distance: 0.1,
        strong: 1,
        weak: 2,
        status: 'weak' as const,
        reason: '誘導線が弱い',
      }
      await act(async () => root.render(<FocusInspector {...props} diagnosis={diagnosis} />))
      const dl = must(container.querySelector('dl'))
      expect(dl.getAttribute('data-diagnosis-status')).toBe('weak')
      expect(must(dl.querySelector('[data-status]')).textContent).toBe(STATUS_LABELS.weak())
      expect(dl.textContent).toContain('0.46')
      expect(dl.textContent).toContain(m.inspector_focus_vector_counts({ strong: 1, weak: 2 }))
      expect(dl.textContent).toContain('誘導線が弱い')

      const { reason: _, ...withoutReason } = diagnosis
      await act(async () => root.render(<FocusInspector {...props} diagnosis={withoutReason} />))
      expect(must(container.querySelector('dl')).textContent).not.toContain(
        m.inspector_focus_reason(),
      )

      for (const status of ['ok', 'miss'] as const) {
        await act(async () =>
          root.render(<FocusInspector {...props} diagnosis={{ ...withoutReason, status }} />),
        )
        expect(must(container.querySelector('[data-status]')).textContent).toBe(
          STATUS_LABELS[status](),
        )
      }
    })
  })
}
