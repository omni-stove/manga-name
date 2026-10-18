import type { ID, Page, Project } from '@manga/schema'
import { Button, Input, Select, XStack } from '@manga/ui'
import { useState } from 'react'
import { addLayoutTemplatePatch, templateOptions } from './project-ops'
import { toasts } from './toasts'
import type { useApplyPatch } from './use-project'

const DEFAULT_TEMPLATE = '3rows'

/**
 * 選んでいるテンプレートの value（templateOptions の value）と、それを変える関数。
 * 選んでいた登録済みのコマ割りが Undo や他の人の操作で消えたら、既定の 3 段に戻す
 */
export function useTemplateChoice(project: Pick<Project, 'layoutTemplates'>) {
  const [value, setValue] = useState(DEFAULT_TEMPLATE)
  const exists = templateOptions(project).some((o) => o.value === value)
  return [exists ? value : DEFAULT_TEMPLATE, setValue] as const
}

/** ページを足すときのテンプレートの選択。登録したコマ割りは組み込みの後ろに見出しを付けて並べる */
export function TemplateSelect({
  project,
  value,
  onChange,
}: {
  project: Pick<Project, 'layoutTemplates'>
  value: string
  onChange(value: string): void
}) {
  const options = templateOptions(project)
  const registered = options.filter((o) => o.registered)
  const option = (o: (typeof options)[number]) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  )
  return (
    <Select
      label="テンプレート"
      inline
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    >
      {options.filter((o) => !o.registered).map(option)}
      {registered.length > 0 && (
        <optgroup label="登録したコマ割り">{registered.map(option)}</optgroup>
      )}
    </Select>
  )
}

/**
 * 開いているページのコマ割りに名前を付けてテンプレートに登録する。登録したものはページの追加や
 * 脚本からの下書きでテンプレートとして選べ、コマの枠だけが写る。コマの無いページでは登録できない
 */
export function LayoutTemplateForm({
  page,
  pageId,
  apply,
}: {
  page: Page
  pageId: ID
  apply: ReturnType<typeof useApplyPatch>['apply']
}) {
  const [name, setName] = useState('')
  return (
    <XStack
      as="form"
      wrap
      gap={8}
      onSubmit={(e) => {
        e.preventDefault()
        if (
          apply(
            'コマ割りをテンプレートに登録',
            (p) => addLayoutTemplatePatch(p, pageId, name).patch,
          )
        ) {
          toasts.push(`「${name.trim()}」をテンプレートに登録しました`, 'info')
          setName('')
        }
      }}
    >
      <Input
        label="テンプレート名"
        required
        value={name}
        placeholder="例: 見開き前の 5 コマ"
        disabled={page.panels.length === 0}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <Button type="submit" size="small" disabled={page.panels.length === 0 || !name.trim()}>
        コマ割りを登録
      </Button>
    </XStack>
  )
}
