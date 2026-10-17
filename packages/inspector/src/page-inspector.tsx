import type { Page } from '@manga/schema'
import { Button, Checkbox, Field, XStack } from '@manga/ui'
import { DEBOUNCE_MS, SelectField, TextField } from './fields'
import styles from './page-inspector.module.css'
import { optionalString, replace } from './patch'
import section from './section.module.css'
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
  onPickReference,
}: PageInspectorProps) {
  const { reference } = page
  return (
    <div className={section.section} data-inspector="page">
      <h3 className={section.title}>ページ</h3>
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
      <XStack as="h4" className={section.heading}>
        参考画像
      </XStack>
      {reference === undefined ? (
        <p className={section.muted}>
          なし。PNG、JPEG、PDF。キャンバスへのドロップと貼り付けでも読み込めます
        </p>
      ) : (
        <>
          <Field label="不透明度" hint={`${Math.round(reference.opacity * 100)}%`}>
            <input
              type="range"
              className={styles.opacity}
              min={0}
              max={1}
              step={0.05}
              value={reference.opacity}
              onChange={(e) => onChange(replace('/reference/opacity', Number(e.target.value)))}
            />
          </Field>
          <Checkbox
            label="表示"
            checked={reference.visible}
            onChange={(e) => onChange(replace('/reference/visible', e.target.checked))}
          />
        </>
      )}
      <XStack wrap className={section.group}>
        <Button size="small" onClick={onPickReference}>
          {reference === undefined ? '読み込む' : '差し替え'}
        </Button>
        {reference !== undefined && (
          <Button
            size="small"
            variant="ghost"
            onClick={() => onChange([{ op: 'remove', path: '/reference' }])}
          >
            削除
          </Button>
        )}
      </XStack>
      <XStack wrap className={section.group}>
        <Button
          variant="primary"
          disabled={generating || page.panels.length === 0}
          onClick={onGenerateAll}
        >
          {generating ? '生成中…' : 'このページを全部生成'}
        </Button>
        <span className={section.muted}>コマ {page.panels.length}</span>
      </XStack>
      {diagnosis && (
        <dl className={styles.diagnosis}>
          <dt>読み順</dt>
          <dd data-ok={diagnosis.readingOrderOk}>
            {diagnosis.readingOrderOk ? 'OK' : '配置と食い違い'}
          </dd>
          <dt>焦点</dt>
          <dd>
            {diagnosis.summary.total} 件: ok {diagnosis.summary.ok} / weak {diagnosis.summary.weak}{' '}
            / miss {diagnosis.summary.miss}
          </dd>
          {diagnosis.issues.length > 0 && (
            <>
              <dt>指摘</dt>
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
