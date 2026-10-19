import { m } from '@manga/i18n'
import { BUBBLE_SHAPES } from '@manga/inspector'
import type { Character, PlanLine } from '@manga/schema'
import { Input, Select, XStack } from '@manga/ui'
import styles from './line-editor.module.css'

/** セリフ 1 つの話し手、形、本文の欄 */
export function LineEditor({
  line,
  characters,
  onChange,
}: {
  line: PlanLine
  characters: readonly Character[]
  onChange(next: PlanLine): void
}) {
  return (
    <XStack gap={4} className={styles.lineFields}>
      <Select
        label={m.web_draft_speaker()}
        hideLabel
        className={styles.lineSelect}
        value={line.speakerId ?? ''}
        onChange={(e) => {
          const { speakerId: _, ...rest } = line
          const id = e.currentTarget.value
          onChange(id === '' ? rest : { ...rest, speakerId: id })
        }}
      >
        <option value="">{m.none()}</option>
        {characters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select
        label={m.bubble_shape()}
        hideLabel
        className={styles.lineSelect}
        value={line.shape}
        onChange={(e) => onChange({ ...line, shape: e.currentTarget.value as PlanLine['shape'] })}
      >
        {BUBBLE_SHAPES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      <Input
        label={m.bubble_text()}
        hideLabel
        className={styles.lineText}
        value={line.text}
        onChange={(e) => onChange({ ...line, text: e.target.value })}
      />
    </XStack>
  )
}
