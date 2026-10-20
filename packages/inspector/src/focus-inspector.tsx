// @vitest-environment jsdom
import { m } from '@manga/i18n'
import {
  BubbleTypefaceSchema,
  type FocusKind,
  type FocusPoint,
  FocusPointSchema,
  type FocusStatus,
  type Patch,
  SFX_SCALE_MAX,
  SFX_SCALE_MIN,
  SFX_TYPEFACE,
} from '@manga/schema'
import { Field, Typography } from '@manga/ui'
import { typefaceLabel } from './bubble-inspector'
import { NumberField, option, SelectField, TextField } from './fields'
import styles from './hint-inspector.module.css'
import { optionalNumber, optionalString, replace } from './patch'
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

type SfxTypefaceOption = { value: NonNullable<FocusPoint['typeface']> | ''; label: string }

/** 描き文字の書体の選択肢。空は書体を持たず既定の書体にする */
function sfxTypefaceOptions(): SfxTypefaceOption[] {
  return [
    {
      value: '',
      label: m.focus_point_typeface_default({ typeface: typefaceLabel(SFX_TYPEFACE) }),
    },
    ...BubbleTypefaceSchema.options.map((value) => ({ value, label: typefaceLabel(value) })),
  ]
}

const isRotation = (n: number) => FocusPointSchema.shape.rotation.safeParse(n).success

/** sfx の焦点にだけ出す、描き文字の傾き・書体・大きさの欄 */
function SfxFields({ focus, onChange }: Pick<FocusInspectorProps, 'focus' | 'onChange'>) {
  const scale = focus.scale ?? 1
  return (
    <>
      <NumberField
        label={m.focus_point_rotation()}
        value={focus.rotation ?? 0}
        min={-180}
        step={1}
        isValid={isRotation}
        onCommit={(n) => onChange(optionalNumber('/rotation', focus.rotation, n, 0))}
      />
      <SelectField
        label={m.focus_point_typeface()}
        value={focus.typeface ?? ''}
        options={sfxTypefaceOptions()}
        onCommit={(v) => onChange(optionalString('/typeface', focus.typeface, v))}
      />
      <Field label={m.focus_point_scale()} hint={`×${scale.toFixed(2)}`}>
        {(described) => (
          <input
            type="range"
            className={styles.slider}
            min={SFX_SCALE_MIN}
            max={SFX_SCALE_MAX}
            step={0.05}
            value={scale}
            onChange={(e) =>
              onChange(optionalNumber('/scale', focus.scale, Number(e.target.value), 1))
            }
            {...described}
          />
        )}
      </Field>
    </>
  )
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
      {focus.kind === 'sfx' && <SfxFields focus={focus} onChange={onChange} />}
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

    test('only an sfx focus shows the rotation, typeface and scale of its lettering', async () => {
      const { container } = await render(
        <FocusInspector focus={focus} characters={project.characters} onChange={() => {}} />,
      )
      expect(focus.kind).not.toBe('sfx')
      expect(container.querySelector('input[type="number"]')).toBeNull()
      expect(container.querySelectorAll('input[type="range"]')).toHaveLength(1)
      const labels = Array.from(container.querySelectorAll('label'), (l) => l.textContent)
      expect(labels.join()).not.toContain(m.focus_point_typeface())
    })

    test('the lettering fields emit add patches, and the defaults remove them', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const sfx = { ...focus, kind: 'sfx' as const, label: 'ドン' }
      const props = { characters: project.characters, onChange }
      const { container, root } = await render(<FocusInspector focus={sfx} {...props} />)

      const rotation = inputLabelled(container, m.focus_point_rotation())
      expect(rotation.value).toBe('0')
      await act(async () => setValue(rotation, '-30'))
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/rotation', value: -30 }])
      onChange.mockClear()
      await act(async () => setValue(rotation, '181'))
      expect(onChange).not.toHaveBeenCalled()
      expect(rotation.getAttribute('aria-invalid')).toBe('true')

      const typeface = selectLabelled(container, m.focus_point_typeface())
      expect(typeface.value).toBe('')
      expect(typeface.options[0]?.textContent).toBe(
        m.focus_point_typeface_default({ typeface: m.bubble_typeface_bold() }),
      )
      await choose(typeface, 'hand')
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/typeface', value: 'hand' }])

      const scale = must(container.querySelectorAll<HTMLInputElement>('input[type="range"]')[1])
      const hintId = must(scale.getAttribute('aria-describedby'))
      expect(must(document.getElementById(hintId)).textContent).toBe('×1.00')
      await act(async () => setValue(scale, '2.5'))
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/scale', value: 2.5 }])

      const styled = { ...sfx, rotation: -30, typeface: 'hand' as const, scale: 2.5 }
      await act(async () => root.render(<FocusInspector focus={styled} {...props} />))
      await act(async () => setValue(inputLabelled(container, m.focus_point_rotation()), '0'))
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/rotation' }])
      await choose(selectLabelled(container, m.focus_point_typeface()), '')
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/typeface' }])
      await act(async () => setValue(scale, '1'))
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/scale' }])
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
