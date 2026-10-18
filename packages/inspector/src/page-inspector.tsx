import { m } from '@manga/i18n'
import type { Page } from '@manga/schema'
import { Button, Checkbox, Field, Typography, XStack } from '@manga/ui'
import { DEBOUNCE_MS, option, SelectField, TextField } from './fields'
import styles from './page-inspector.module.css'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { PageInspectorProps } from './types'

const SIDES: readonly { value: Page['side']; label: string }[] = [
  option('right', m.inspector_page_side_right),
  option('left', m.inspector_page_side_left),
  option('single', m.inspector_page_side_single),
]

export function PageInspector({
  page,
  diagnosis,
  generating = false,
  onChange,
  onGenerateAll,
  onPickReference,
}: PageInspectorProps) {
  const { reference } = page
  return (
    <div className={section.section} data-inspector="page">
      <Typography variant="subheading" className={section.title}>
        {m.inspector_page_title()}
      </Typography>
      <SelectField
        label={m.inspector_page_side()}
        value={page.side}
        options={SIDES}
        onCommit={(v) => onChange(replace('/side', v))}
      />
      <TextField
        label={m.inspector_note()}
        value={page.note ?? ''}
        rows={4}
        delayMs={DEBOUNCE_MS}
        onCommit={(v) => onChange(optionalString('/note', page.note, v))}
      />
      <Typography variant="label" tone="muted" className={section.heading}>
        {m.inspector_page_reference()}
      </Typography>
      {reference === undefined ? (
        <Typography tone="muted">{m.inspector_page_reference_empty()}</Typography>
      ) : (
        <>
          <Field
            label={m.inspector_page_reference_opacity()}
            hint={`${Math.round(reference.opacity * 100)}%`}
          >
            {(described) => (
              <input
                type="range"
                className={styles.opacity}
                min={0}
                max={1}
                step={0.05}
                value={reference.opacity}
                onChange={(e) => onChange(replace('/reference/opacity', Number(e.target.value)))}
                {...described}
              />
            )}
          </Field>
          <Checkbox
            label={m.inspector_page_reference_visible()}
            checked={reference.visible}
            onChange={(e) => onChange(replace('/reference/visible', e.target.checked))}
          />
        </>
      )}
      <XStack wrap className={section.group}>
        <Button size="small" onClick={onPickReference}>
          {reference === undefined ? m.inspector_page_reference_load() : m.inspector_replace()}
        </Button>
        {reference !== undefined && (
          <Button
            size="small"
            variant="ghost"
            onClick={() => onChange([{ op: 'remove', path: '/reference' }])}
          >
            {m.inspector_remove()}
          </Button>
        )}
      </XStack>
      <XStack wrap className={section.group}>
        <Button
          variant="primary"
          disabled={generating || page.panels.length === 0}
          onClick={onGenerateAll}
        >
          {generating ? m.inspector_generating() : m.inspector_page_generate_all()}
        </Button>
        <Typography as="span" tone="muted">
          {m.inspector_panel_title({ order: page.panels.length })}
        </Typography>
      </XStack>
      {diagnosis && (
        <dl className={styles.diagnosis}>
          <dt>{m.inspector_reading_order()}</dt>
          <dd data-ok={diagnosis.readingOrderOk}>
            {diagnosis.readingOrderOk ? 'OK' : m.inspector_page_reading_order_mismatch()}
          </dd>
          <dt>{m.inspector_focus()}</dt>
          <dd>{m.inspector_page_focus_summary(diagnosis.summary)}</dd>
          {diagnosis.issues.length > 0 && (
            <>
              <dt>{m.inspector_page_issues()}</dt>
              <dd>
                <ul className={styles.issues}>
                  {diagnosis.issues.map((issue, i) => (
                    <li
                      key={`${issue.code}-${issue.panelId ?? ''}-${issue.focusPointId ?? i}`}
                      className={styles.issue}
                      data-severity={issue.severity}
                    >
                      [{issue.severity}] {issue.message}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}
