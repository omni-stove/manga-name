// @vitest-environment jsdom
import { m } from '@manga/i18n'
import {
  type Bubble,
  BubbleSchema,
  BubbleTypefaceSchema,
  bubbleTypeface,
  type Patch,
} from '@manga/schema'
import { Checkbox, Typography } from '@manga/ui'
import { DEBOUNCE_MS, NumberField, option, SelectField, TextField } from './fields'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { BubbleInspectorProps } from './types'

/** フキダシの形と、画面での呼び名 */
export const BUBBLE_SHAPES: readonly { value: Bubble['shape']; label: string }[] = [
  option('normal', m.bubble_shape_normal),
  option('shout', m.bubble_shape_shout),
  option('thought', m.bubble_shape_thought),
  option('whisper', m.bubble_shape_whisper),
  option('tremble', m.bubble_shape_tremble),
  option('electronic', m.bubble_shape_electronic),
  option('urchin', m.bubble_shape_urchin),
  option('narration', m.bubble_shape_narration),
  option('none', m.bubble_shape_none),
]

const typefaceLabel = (typeface: NonNullable<Bubble['typeface']>) =>
  m[`bubble_typeface_${typeface}` as const]()

/** 書体の選択肢。空は書体を持たず形に合わせる */
function typefaceOptions(
  shape: Bubble['shape'],
): { value: NonNullable<Bubble['typeface']> | ''; label: string }[] {
  return [
    {
      value: '',
      label: m.bubble_typeface_auto({ typeface: typefaceLabel(bubbleTypeface({ shape })) }),
    },
    ...BubbleTypefaceSchema.options.map((value) => ({ value, label: typefaceLabel(value) })),
  ]
}

const isOrder = (n: number) => BubbleSchema.shape.order.safeParse(n).success

export function BubbleInspector({ bubble, characters, onChange }: BubbleInspectorProps) {
  return (
    <div className={section.section} data-inspector="bubble">
      <Typography variant="subheading" className={section.title}>
        {m.inspector_bubble_title({ order: bubble.order })}
      </Typography>
      <SelectField
        label={m.bubble_speaker()}
        value={bubble.speakerId ?? ''}
        options={[
          { value: '', label: m.none() },
          ...characters.map((c) => ({ value: c.id, label: c.name })),
        ]}
        onCommit={(v) => onChange(optionalString('/speakerId', bubble.speakerId, v))}
      />
      <TextField
        label={m.bubble_text()}
        value={bubble.text}
        rows={4}
        delayMs={DEBOUNCE_MS}
        placeholder={m.inspector_bubble_text_placeholder()}
        onCommit={(v) => v !== bubble.text && onChange(replace('/text', v))}
      />
      <SelectField
        label={m.bubble_shape()}
        value={bubble.shape}
        options={BUBBLE_SHAPES}
        onCommit={(v) => onChange(replace('/shape', v))}
      />
      <SelectField
        label={m.bubble_typeface()}
        value={bubble.typeface ?? ''}
        options={typefaceOptions(bubble.shape)}
        onCommit={(v) => onChange(optionalString('/typeface', bubble.typeface, v))}
      />
      <Checkbox
        label={m.bubble_fill_black()}
        checked={bubble.fill === 'black'}
        onChange={(e) =>
          onChange(
            e.target.checked
              ? [{ op: 'add', path: '/fill', value: 'black' }]
              : [{ op: 'remove', path: '/fill' }],
          )
        }
      />
      <Checkbox
        label={m.bubble_overflow()}
        checked={bubble.overflow === true}
        onChange={(e) =>
          onChange(
            e.target.checked
              ? [{ op: 'add', path: '/overflow', value: true }]
              : [{ op: 'remove', path: '/overflow' }],
          )
        }
      />
      <NumberField
        label={m.bubble_order()}
        value={bubble.order}
        min={1}
        step={1}
        isValid={isOrder}
        commitOnBlur
        onCommit={(n) => onChange(replace('/order', n))}
      />
    </div>
  )
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { act } = await import('react')
  const { choose, inputLabelled, must, project, render, samplePanel, selectLabelled, setValue } =
    await import('./dom-harness')

  describe('BubbleInspector', () => {
    test('clearing the speaker removes it and text is debounced', async () => {
      vi.useFakeTimers()
      const onChange = vi.fn<(patch: Patch) => void>()
      const bubble = must(samplePanel.bubbles[0])
      const { container } = await render(
        <BubbleInspector
          bubble={{ ...bubble, speakerId: 'chr_e' }}
          characters={project.characters}
          onChange={onChange}
        />,
      )
      const select = must(container.querySelector('select'))
      await act(async () => {
        select.value = ''
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/speakerId' }])

      await act(async () => setValue(inputLabelled(container, m.bubble_text()), '新しいセリフ'))
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS))
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'replace', path: '/text', value: '新しいセリフ' },
      ])
    })

    test('allowing overflow adds it, and disallowing it removes it', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const bubble = must(samplePanel.bubbles[0])
      const outside = { ...bubble, pos: { x: 1, y: 0 }, overflow: true }
      const props = { bubble, characters: project.characters, onChange }
      const { container, root } = await render(<BubbleInspector {...props} />)
      const checkbox = must(
        [...container.querySelectorAll('label')]
          .find((el) => el.textContent === m.bubble_overflow())
          ?.querySelector<HTMLInputElement>('input[type="checkbox"]'),
      )
      expect(checkbox.checked).toBe(false)
      await act(async () => checkbox.click())
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/overflow', value: true }])

      await act(async () => root.render(<BubbleInspector {...props} bubble={outside} />))
      expect(checkbox.checked).toBe(true)
      await act(async () => checkbox.click())
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/overflow' }])
    })

    test('the black bubble checkbox adds and removes fill', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const bubble = must(samplePanel.bubbles[0])
      const props = { bubble, characters: project.characters, onChange }
      const { container, root } = await render(<BubbleInspector {...props} />)
      const checkbox = must(
        [...container.querySelectorAll('label')]
          .find((el) => el.textContent === m.bubble_fill_black())
          ?.querySelector<HTMLInputElement>('input[type="checkbox"]'),
      )
      expect(checkbox.checked).toBe(false)
      await act(async () => checkbox.click())
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/fill', value: 'black' }])

      await act(async () =>
        root.render(<BubbleInspector {...props} bubble={{ ...bubble, fill: 'black' }} />),
      )
      expect(checkbox.checked).toBe(true)
      await act(async () => checkbox.click())
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/fill' }])
    })

    test('the typeface select names the typeface of the shape, and adds and removes typeface', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const bubble = { ...must(samplePanel.bubbles[0]), shape: 'narration' as const }
      const props = { characters: project.characters, onChange }
      const { container, root } = await render(<BubbleInspector bubble={bubble} {...props} />)
      const select = () => selectLabelled(container, m.bubble_typeface())
      expect(select().value).toBe('')
      expect(select().options[0]?.textContent).toBe(
        m.bubble_typeface_auto({ typeface: m.bubble_typeface_mincho() }),
      )
      await choose(select(), 'rounded')
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'add', path: '/typeface', value: 'rounded' },
      ])

      await act(async () =>
        root.render(<BubbleInspector bubble={{ ...bubble, typeface: 'rounded' }} {...props} />),
      )
      expect(select().value).toBe('rounded')
      await choose(select(), '')
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/typeface' }])
    })

    test('the typeface select offers the hand-written typeface', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const bubble = { ...must(samplePanel.bubbles[0]), shape: 'whisper' as const }
      const { container } = await render(
        <BubbleInspector bubble={bubble} characters={project.characters} onChange={onChange} />,
      )
      const select = selectLabelled(container, m.bubble_typeface())
      const hand = Array.from(select.options).find((o) => o.value === 'hand')
      expect(hand?.textContent).toBe(m.bubble_typeface_hand())
      await choose(select, 'hand')
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'add', path: '/typeface', value: 'hand' }])
    })
  })
}
