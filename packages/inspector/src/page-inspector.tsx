// @vitest-environment jsdom
import { m } from '@manga/i18n'
import type { Page, PageDiagnosis, Patch } from '@manga/schema'
import { Button, Checkbox, Field, RemoveButton, Typography, XStack } from '@manga/ui'
import { DEBOUNCE_MS, TextField } from './fields'
import { SEVERITY_LABELS } from './issue-list'
import styles from './page-inspector.module.css'
import { optionalString, replace } from './patch'
import section from './section.module.css'
import type { PageInspectorProps } from './types'

export function PageInspector({
  page,
  diagnosis,
  generating = false,
  editable = true,
  onChange,
  onGenerateAll,
  onPickReference,
}: PageInspectorProps) {
  const { reference } = page
  return (
    <div className={section.section} data-inspector="page">
      <Typography variant="subheading" className={section.title}>
        {m.page()}
      </Typography>
      <fieldset disabled={!editable} className={section.fields}>
        <TextField
          label={m.page_note()}
          value={page.note ?? ''}
          rows={4}
          delayMs={DEBOUNCE_MS}
          onCommit={(v) => onChange(optionalString('/note', page.note, v))}
        />
        <Typography variant="label" tone="muted" className={section.heading}>
          {m.page_reference()}
        </Typography>
        {reference === undefined ? (
          <Typography tone="muted">{m.inspector_page_reference_empty()}</Typography>
        ) : (
          <>
            <Field
              label={m.reference_image_opacity()}
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
              label={m.reference_image_visible()}
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
            <RemoveButton
              size="small"
              label={m.remove()}
              onClick={() => onChange([{ op: 'remove', path: '/reference' }])}
            />
          )}
        </XStack>
      </fieldset>
      <XStack wrap className={section.group}>
        <Button
          variant="primary"
          data-action="generate-all"
          disabled={generating || page.panels.length === 0 || !onGenerateAll}
          onClick={onGenerateAll}
        >
          {generating ? m.generating() : m.inspector_page_generate_all()}
        </Button>
        <Typography as="span" tone="muted">
          {m.inspector_panel_title({ order: page.panels.length })}
        </Typography>
      </XStack>
      {diagnosis && (
        <dl className={styles.diagnosis}>
          <dt>{m.inspector_reading_order()}</dt>
          <dd data-ok={diagnosis.readingOrderOk}>
            {diagnosis.readingOrderOk
              ? m.inspector_page_reading_order_ok()
              : m.inspector_page_reading_order_mismatch()}
          </dd>
          <dt>{m.focus_point()}</dt>
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
                      [{SEVERITY_LABELS[issue.severity]()}] {issue.message}
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

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { act } = await import('react')
  const { buttonNamed, inputLabelled, must, render, samplePage, setValue } =
    await import('./dom-harness')

  describe('PageInspector', () => {
    const page = samplePage
    const withReference: Page = {
      ...page,
      reference: { ref: 'blob:ref_page', opacity: 0.5, visible: true },
    }

    test('note is debounced', async () => {
      vi.useFakeTimers()
      const onChange = vi.fn<(patch: Patch) => void>()
      const { container } = await render(
        <PageInspector
          page={page}
          onChange={onChange}
          onGenerateAll={() => {}}
          onPickReference={() => {}}
        />,
      )
      await act(async () => setValue(inputLabelled(container, m.page_note()), '見開きの導入'))
      expect(onChange).not.toHaveBeenCalled()
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS))
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'add', path: '/note', value: '見開きの導入' },
      ])
    })

    test('without a reference only offers to load one', async () => {
      const onPickReference = vi.fn()
      const { container } = await render(
        <PageInspector
          page={page}
          onChange={() => {}}
          onGenerateAll={() => {}}
          onPickReference={onPickReference}
        />,
      )
      expect(container.querySelector('input[type="range"]')).toBeNull()
      expect(container.querySelector('input[type="checkbox"]')).toBeNull()
      expect(
        [...container.querySelectorAll('button')].some(
          (b) => b.getAttribute('aria-label') === m.remove(),
        ),
      ).toBe(false)
      await act(async () => buttonNamed(container, m.inspector_page_reference_load()).click())
      expect(onPickReference).toHaveBeenCalledTimes(1)
    })

    test('a reference has opacity, visibility, replace and delete controls', async () => {
      const onChange = vi.fn<(patch: Patch) => void>()
      const onPickReference = vi.fn()
      const { container } = await render(
        <PageInspector
          page={withReference}
          onChange={onChange}
          onGenerateAll={() => {}}
          onPickReference={onPickReference}
        />,
      )
      const opacity = must(container.querySelector<HTMLInputElement>('input[type="range"]'))
      const hintId = must(opacity.getAttribute('aria-describedby'))
      expect(must(document.getElementById(hintId)).textContent).toBe('50%')
      await act(async () => setValue(opacity, '0.25'))
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'replace', path: '/reference/opacity', value: 0.25 },
      ])

      const visible = must(container.querySelector<HTMLInputElement>('input[type="checkbox"]'))
      expect(visible.checked).toBe(true)
      await act(async () => visible.click())
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'replace', path: '/reference/visible', value: false },
      ])

      await act(async () => buttonNamed(container, m.inspector_replace()).click())
      expect(onPickReference).toHaveBeenCalledTimes(1)
      await act(async () => buttonNamed(container, m.remove()).click())
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/reference' }])
    })

    test('generate all is disabled while generating and for a page without panels', async () => {
      const onGenerateAll = vi.fn()
      const props = {
        page,
        onChange: () => {},
        onGenerateAll,
        onPickReference: () => {},
      }
      const { container, root } = await render(<PageInspector {...props} />)
      expect(container.textContent).toContain(
        m.inspector_panel_title({ order: page.panels.length }),
      )
      await act(async () => buttonNamed(container, m.inspector_page_generate_all()).click())
      expect(onGenerateAll).toHaveBeenCalledTimes(1)

      await act(async () => root.render(<PageInspector {...props} generating />))
      expect(buttonNamed(container, m.generating()).disabled).toBe(true)

      await act(async () =>
        root.render(<PageInspector {...props} page={{ ...page, panels: [] }} />),
      )
      expect(buttonNamed(container, m.inspector_page_generate_all()).disabled).toBe(true)

      await act(async () => root.render(<PageInspector {...props} onGenerateAll={undefined} />))
      expect(buttonNamed(container, m.inspector_page_generate_all()).disabled).toBe(true)
    })

    test('editable = false disables everything but generate all', async () => {
      const { container } = await render(
        <PageInspector
          page={withReference}
          editable={false}
          onChange={() => {}}
          onGenerateAll={() => {}}
          onPickReference={() => {}}
        />,
      )
      const enabled = [
        ...container.querySelectorAll<HTMLButtonElement>('button, input, select, textarea'),
      ]
        .filter((el) => !el.matches(':disabled'))
        .map((el) => el.textContent)
      expect(enabled).toEqual([m.inspector_page_generate_all()])
    })

    test('shows the page diagnosis summary and issues', async () => {
      const diagnosis: PageDiagnosis = {
        pageId: page.id,
        readingOrderOk: false,
        inferredOrder: [],
        panels: [],
        bubbleChain: [],
        summary: { total: 5, ok: 3, weak: 1, miss: 1 },
        issues: [
          { severity: 'error', code: 'READING_ORDER', message: '読み順が逆' },
          { severity: 'warning', code: 'FOCUS_WEAK', panelId: 'pn_2', message: '焦点が弱い' },
        ],
      }
      const { container } = await render(
        <PageInspector
          page={page}
          diagnosis={diagnosis}
          onChange={() => {}}
          onGenerateAll={() => {}}
          onPickReference={() => {}}
        />,
      )
      const dl = must(container.querySelector('dl'))
      expect(must(dl.querySelector('[data-ok]')).textContent).toBe(
        m.inspector_page_reading_order_mismatch(),
      )
      expect(dl.textContent).toContain(
        m.inspector_page_focus_summary({ total: 5, ok: 3, weak: 1, miss: 1 }),
      )
      const issues = [...dl.querySelectorAll('li')]
      expect(issues.map((li) => li.getAttribute('data-severity'))).toEqual(['error', 'warning'])
      expect(issues.map((li) => li.textContent)).toEqual([
        `[${SEVERITY_LABELS.error()}] 読み順が逆`,
        `[${SEVERITY_LABELS.warning()}] 焦点が弱い`,
      ])
    })

    test('labels a matching reading order as ok and an info issue by its severity', async () => {
      const diagnosis: PageDiagnosis = {
        pageId: page.id,
        readingOrderOk: true,
        inferredOrder: [],
        panels: [],
        bubbleChain: [],
        summary: { total: 0, ok: 0, weak: 0, miss: 0 },
        issues: [{ severity: 'info', code: 'READING_ORDER', message: '補足' }],
      }
      const { container } = await render(
        <PageInspector
          page={page}
          diagnosis={diagnosis}
          onChange={() => {}}
          onGenerateAll={() => {}}
          onPickReference={() => {}}
        />,
      )
      const dl = must(container.querySelector('dl'))
      expect(must(dl.querySelector('[data-ok]')).textContent).toBe(
        m.inspector_page_reading_order_ok(),
      )
      expect(must(dl.querySelector('li')).textContent).toBe(`[${SEVERITY_LABELS.info()}] 補足`)
    })
  })
}
