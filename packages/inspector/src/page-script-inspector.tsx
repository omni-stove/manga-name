// @vitest-environment jsdom
import { m } from '@manga/i18n'
import type { Patch } from '@manga/schema'
import { DEBOUNCE_MS, TextField } from './fields'
import { optionalString } from './patch'
import section from './section.module.css'
import type { PageScriptInspectorProps } from './types'

/** ページの脚本（Page.script）の欄。入力は DEBOUNCE_MS 待ってから Patch にし、空にすると項目ごと消す */
export function PageScriptInspector({ page, editable = true, onChange }: PageScriptInspectorProps) {
  return (
    <fieldset disabled={!editable} className={section.fields} data-inspector="page-script">
      <TextField
        label={m.inspector_page_script()}
        value={page.script ?? ''}
        rows={10}
        placeholder={m.inspector_page_script_placeholder()}
        delayMs={DEBOUNCE_MS}
        onCommit={(v) => onChange(optionalString('/script', page.script, v))}
      />
    </fieldset>
  )
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { act } = await import('react')
  const { inputLabelled, render, samplePage, setValue } = await import('./dom-harness')

  describe('PageScriptInspector', () => {
    const page = samplePage

    test('the script is debounced and an emptied script removes the field', async () => {
      vi.useFakeTimers()
      const onChange = vi.fn<(patch: Patch) => void>()
      const { container } = await render(<PageScriptInspector page={page} onChange={onChange} />)
      await act(async () =>
        setValue(inputLabelled(container, m.inspector_page_script()), 'E「……ここか」'),
      )
      expect(onChange).not.toHaveBeenCalled()
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS))
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'add', path: '/script', value: 'E「……ここか」' },
      ])

      const scripted = await render(
        <PageScriptInspector page={{ ...page, script: 's' }} onChange={onChange} />,
      )
      await act(async () =>
        setValue(inputLabelled(scripted.container, m.inspector_page_script()), ''),
      )
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS))
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/script' }])
    })

    test('is read-only when not editable', async () => {
      const { container } = await render(
        <PageScriptInspector page={page} editable={false} onChange={() => {}} />,
      )
      expect(inputLabelled(container, m.inspector_page_script()).matches(':disabled')).toBe(true)
    })
  })
}
