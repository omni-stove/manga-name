import { type Bubble, type BubbleFrame, BubbleSchema, fitBubble, type Patch } from '@manga/schema'
import { Checkbox, Typography } from '@manga/ui'
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

/** はみ出しを許すなら overflow を足し、許さないなら overflow を外して本体を枠に収める */
function overflowPatch(bubble: Bubble, frame: BubbleFrame, overflow: boolean): Patch {
  if (overflow) return [{ op: 'add', path: '/overflow', value: true }]
  const { overflow: _, ...rest } = bubble
  const fitted = fitBubble(rest, frame)
  return [
    ...(bubble.overflow === undefined ? [] : [{ op: 'remove' as const, path: '/overflow' }]),
    ...(fitted.pos.x !== bubble.pos.x || fitted.pos.y !== bubble.pos.y
      ? replace('/pos', fitted.pos)
      : []),
    ...(fitted.size.w !== bubble.size.w || fitted.size.h !== bubble.size.h
      ? replace('/size', fitted.size)
      : []),
  ]
}

export function BubbleInspector({ bubble, characters, frame, onChange }: BubbleInspectorProps) {
  return (
    <div className={section.section} data-inspector="bubble">
      <Typography variant="subheading" className={section.title}>
        フキダシ {bubble.order}
      </Typography>
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
      <Checkbox
        label="枠からはみ出す"
        checked={bubble.overflow === true}
        onChange={(e) => onChange(overflowPatch(bubble, frame, e.target.checked))}
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
