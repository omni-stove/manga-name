import { m } from '@manga/i18n'
import { type Bubble, BubbleSchema } from '@manga/schema'
import { Checkbox, Typography } from '@manga/ui'
import { DEBOUNCE_MS, NumberField, option, SelectField, TextField } from './fields'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { BubbleInspectorProps } from './types'

/** フキダシの形と、画面での呼び名 */
export const BUBBLE_SHAPES: readonly { value: Bubble['shape']; label: string }[] = [
  option('normal', m.inspector_bubble_shape_normal),
  option('shout', m.inspector_bubble_shape_shout),
  option('thought', m.inspector_bubble_shape_thought),
  option('whisper', m.inspector_bubble_shape_whisper),
  option('tremble', m.inspector_bubble_shape_tremble),
  option('electronic', m.inspector_bubble_shape_electronic),
  option('urchin', m.inspector_bubble_shape_urchin),
  option('narration', m.inspector_bubble_shape_narration),
  option('none', m.inspector_bubble_shape_none),
]

const isOrder = (n: number) => BubbleSchema.shape.order.safeParse(n).success

export function BubbleInspector({ bubble, characters, onChange }: BubbleInspectorProps) {
  return (
    <div className={section.section} data-inspector="bubble">
      <Typography variant="subheading" className={section.title}>
        {m.inspector_bubble_title({ order: bubble.order })}
      </Typography>
      <SelectField
        label={m.inspector_bubble_speaker()}
        value={bubble.speakerId ?? ''}
        options={[
          { value: '', label: m.inspector_none() },
          ...characters.map((c) => ({ value: c.id, label: c.name })),
        ]}
        onCommit={(v) => onChange(optionalString('/speakerId', bubble.speakerId, v))}
      />
      <TextField
        label={m.inspector_bubble_text()}
        value={bubble.text}
        rows={4}
        delayMs={DEBOUNCE_MS}
        onCommit={(v) => v !== bubble.text && onChange(replace('/text', v))}
      />
      <SelectField
        label={m.inspector_bubble_shape()}
        value={bubble.shape}
        options={BUBBLE_SHAPES}
        onCommit={(v) => onChange(replace('/shape', v))}
      />
      <Checkbox
        label={m.inspector_bubble_overflow()}
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
        label={m.inspector_bubble_order()}
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
