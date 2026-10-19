// @vitest-environment jsdom
import { m } from '@manga/i18n'
import { type Bubble, BubbleSchema, type Patch } from '@manga/schema'
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
        onCommit={(v) => v !== bubble.text && onChange(replace('/text', v))}
      />
      <SelectField
        label={m.bubble_shape()}
        value={bubble.shape}
        options={BUBBLE_SHAPES}
        onCommit={(v) => onChange(replace('/shape', v))}
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
  const { inputLabelled, must, project, render, samplePanel, setValue } = await import(
    './dom-harness'
  )

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
  })
}
