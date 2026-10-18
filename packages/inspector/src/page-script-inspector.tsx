import { m } from '@manga/i18n'
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
        rows={16}
        placeholder={m.inspector_page_script_placeholder()}
        delayMs={DEBOUNCE_MS}
        onCommit={(v) => onChange(optionalString('/script', page.script, v))}
      />
    </fieldset>
  )
}
