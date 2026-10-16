import { type Bubble, BubbleSchema } from '@manga/schema'
import { DEBOUNCE_MS, NumberField, SelectField, TextField } from './fields'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { BubbleInspectorProps } from './types'

const SHAPES: readonly { value: Bubble['shape']; label: string }[] = [
  { value: 'normal', label: '普通' },
  { value: 'shout', label: '叫び' },
  { value: 'thought', label: '思考' },
  { value: 'narration', label: 'ナレーション' },
]

const isOrder = (n: number) => BubbleSchema.shape.order.safeParse(n).success

export function BubbleInspector({ bubble, characters, onChange }: BubbleInspectorProps) {
  return (
    <div className={section.section} data-inspector="bubble">
      <h3 className={section.title}>フキダシ {bubble.order}</h3>
      <SelectField
        label="話者"
        value={bubble.speakerId ?? ''}
        options={[
          { value: '', label: '（なし）' },
          ...characters.map((c) => ({ value: c.id, label: c.name })),
        ]}
        onCommit={(v) => onChange(optionalString('/speakerId', bubble.speakerId, v))}
      />
      <TextField
        label="セリフ"
        value={bubble.text}
        rows={4}
        delayMs={DEBOUNCE_MS}
        onCommit={(v) => v !== bubble.text && onChange(replace('/text', v))}
      />
      <SelectField
        label="形"
        value={bubble.shape}
        options={SHAPES}
        onCommit={(v) => onChange(replace('/shape', v))}
      />
      <NumberField
        label="順番"
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
