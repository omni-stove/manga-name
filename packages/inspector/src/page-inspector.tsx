import type { Page } from '@manga/schema'
import { DEBOUNCE_MS, SelectField, TextField } from './fields'
import { optionalString, replace } from './patch'
import type { PageInspectorProps } from './types'

const SIDES: readonly { value: Page['side']; label: string }[] = [
  { value: 'right', label: '右ページ' },
  { value: 'left', label: '左ページ' },
  { value: 'single', label: '単ページ' },
]

export function PageInspector({
  page,
  diagnosis,
  generating = false,
  onChange,
  onGenerateAll,
}: PageInspectorProps) {
  return (
    <div className="inspector-section" data-inspector="page">
      <h3>ページ</h3>
      <SelectField
        label="見開き"
        value={page.side}
        options={SIDES}
        onCommit={(v) => onChange(replace('/side', v))}
      />
      <TextField
        label="メモ"
        value={page.note ?? ''}
        rows={4}
        delayMs={DEBOUNCE_MS}
        onCommit={(v) => onChange(optionalString('/note', page.note, v))}
      />
      <div className="in-group">
        <button
          type="button"
          disabled={generating || page.panels.length === 0}
          onClick={onGenerateAll}
        >
          {generating ? '生成中…' : 'このページを全部生成'}
        </button>
        <span className="in-muted">コマ {page.panels.length}</span>
      </div>
      {diagnosis && (
        <dl className="in-diagnosis">
          <dt>読み順</dt>
          <dd>{diagnosis.readingOrderOk ? 'OK' : '配置と食い違い'}</dd>
          <dt>焦点</dt>
          <dd>
            {diagnosis.summary.total} 件: ok {diagnosis.summary.ok} / weak {diagnosis.summary.weak}{' '}
            / miss {diagnosis.summary.miss}
          </dd>
          {diagnosis.issues.length > 0 && (
            <>
              <dt>指摘</dt>
              <dd>
                <ul>
                  {diagnosis.issues.map((issue, i) => (
                    <li key={`${issue.code}-${issue.panelId ?? ''}-${issue.focusPointId ?? i}`}>
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
