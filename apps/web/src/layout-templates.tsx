import { m } from '@manga/i18n'
import { createPage, createSpreadPage, type ID, type Page, type Project } from '@manga/schema'
import {
  Button,
  ConfirmDialog,
  Dialog,
  Input,
  RemoveButton,
  Select,
  Typography,
  YStack,
} from '@manga/ui'
import { useState } from 'react'
import styles from './layout-templates.module.css'
import { PageThumbnail } from './page-thumbnail'
import {
  addLayoutTemplatePatch,
  addPagePatch,
  canAddSpread,
  removeLayoutTemplatePatch,
  resolveTemplate,
  templateOptions,
} from './project-ops'
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
  return (
    <Select
      label={m.layout_template()}
      inline
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
    >
      {options.filter((o) => !o.registered).map(templateOption)}
      {registered.length > 0 && (
        <optgroup label={m.web_layout_template_registered_group()}>
          {registered.map(templateOption)}
        </optgroup>
      )}
    </Select>
  )
}

function templateOption(o: ReturnType<typeof templateOptions>[number]) {
  return (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  )
}

/**
 * 開いているページのコマ割りに名前を付けてテンプレートに登録するダイアログ。登録したものはページの追加や
 * 脚本からの下書きでテンプレートとして選べ、コマの枠だけが写る。登録できたら閉じる
 */
export function LayoutTemplateDialog({
  pageId,
  apply,
  onClose,
}: {
  pageId: ID
  apply: ReturnType<typeof useApplyPatch>['apply']
  onClose(): void
}) {
  const [name, setName] = useState('')
  return (
    <Dialog
      title={m.web_layout_template_register_title()}
      onClose={onClose}
      onSubmit={() => {
        if (
          apply(
            m.web_layout_template_register_title(),
            (p) => addLayoutTemplatePatch(p, pageId, name).patch,
          )
        ) {
          toasts.push(m.web_layout_template_registered({ name: name.trim() }), 'info')
          onClose()
        }
      }}
      actions={
        <>
          <Button type="button" onClick={onClose}>
            {m.cancel()}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {m.web_layout_template_register()}
          </Button>
        </>
      }
    >
      <Input
        label={m.layout_template_name()}
        required
        autoFocus
        value={name}
        placeholder={m.web_layout_template_name_placeholder()}
        onChange={(e) => setName(e.currentTarget.value)}
      />
    </Dialog>
  )
}

/** 見開きの選択肢の value。組み込みテンプレートの名前や登録したコマ割りの id とは重ならない */
const SPREAD = 'spread'

/**
 * 話の末尾にページを足すダイアログ。組み込みと登録したコマ割り、見開きを、足したときのページの見た目で並べて選ぶ。
 * 見開きを始められない位置（canAddSpread）では見開きを選べず、理由を添える。
 * 登録したコマ割りは確認を経てここから消せる。ダブルクリックでその場で足す。
 * 足せたら `onAdded` に新しいページの id を渡す
 */
export function AddPageDialog({
  project,
  episodeId,
  apply,
  onAdded,
  onClose,
}: {
  project: Project
  episodeId: ID
  apply: ReturnType<typeof useApplyPatch>['apply']
  onAdded(pageId: ID): void
  onClose(): void
}) {
  const [template, setTemplate] = useTemplateChoice(project)
  const [spreadChosen, setSpreadChosen] = useState(false)
  const [removing, setRemoving] = useState<{ id: string; name: string }>()
  const spreadAvailable = canAddSpread(project, episodeId)
  const spread = spreadChosen && spreadAvailable
  const { direction, pageSize } = project.settings
  const options = templateOptions(project).map((o) => ({
    ...o,
    preview: createPage(resolveTemplate(project, o.value), direction),
  }))
  const add = (spread: boolean, template: string) => {
    let added: ID | undefined
    const applied = apply(m.web_episode_add_page(), (p) => {
      const result = addPagePatch(p, resolveTemplate(p, template), episodeId, spread)
      added = result.page.id
      return result.patch
    })
    if (applied && added) onAdded(added)
  }
  const choose = (value: string) => {
    setSpreadChosen(value === SPREAD)
    if (value !== SPREAD) setTemplate(value)
  }
  const option = (o: { value: string; label: string; preview: Page; disabledReason?: string }) => {
    const isSpread = o.value === SPREAD
    return (
      <label
        className={styles.option}
        title={o.disabledReason}
        onDoubleClick={() => {
          if (!o.disabledReason) add(isSpread, isSpread ? template : o.value)
        }}
      >
        <input
          type="radio"
          name="layout"
          className={styles.radio}
          value={o.value}
          checked={spread ? isSpread : o.value === template}
          disabled={o.disabledReason !== undefined}
          onChange={() => choose(o.value)}
        />
        <span aria-hidden className={styles.preview}>
          <PageThumbnail page={o.preview} pageSize={pageSize} />
        </span>
        <span className={styles.label}>{o.label}</span>
        {o.disabledReason && (
          <Typography as="small" variant="caption" tone="muted">
            {o.disabledReason}
          </Typography>
        )}
      </label>
    )
  }
  const builtIns = options.filter((o) => !o.registered)
  const registered = options.filter((o) => o.registered)
  return (
    <>
      <Dialog
        title={m.web_episode_add_page()}
        className={styles.dialog}
        onClose={onClose}
        onSubmit={() => add(spread, template)}
        actions={
          <>
            <Button type="button" onClick={onClose}>
              {m.cancel()}
            </Button>
            <Button type="submit" variant="primary">
              {m.web_episode_add_page()}
            </Button>
          </>
        }
      >
        <YStack gap={16} className={styles.body}>
          <fieldset className={styles.group}>
            <legend className={styles.legend}>{m.layout_template()}</legend>
            <ul className={styles.options}>
              {builtIns.map((o) => (
                <li key={o.value}>{option(o)}</li>
              ))}
              <li className={styles.wide}>
                {option({
                  value: SPREAD,
                  label: m.web_episode_spread(),
                  preview: createSpreadPage(),
                  disabledReason: spreadAvailable ? undefined : m.web_episode_spread_unavailable(),
                })}
              </li>
            </ul>
          </fieldset>
          {registered.length > 0 && (
            <fieldset className={styles.group}>
              <legend className={styles.legend}>{m.web_layout_template_registered_group()}</legend>
              <ul className={styles.options}>
                {registered.map((o) => (
                  <li key={o.value} className={styles.registered}>
                    {option(o)}
                    <RemoveButton
                      size="small"
                      className={styles.remove}
                      label={m.web_layout_template_remove_named({ name: o.label })}
                      onClick={() => setRemoving({ id: o.value, name: o.label })}
                    />
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
        </YStack>
      </Dialog>
      {removing && (
        <ConfirmDialog
          title={m.web_episode_remove_template()}
          message={m.web_episode_remove_template_confirm({ name: removing.name })}
          confirmLabel={m.remove()}
          onConfirm={() => {
            apply(m.web_episode_remove_template(), (p) => removeLayoutTemplatePatch(p, removing.id))
            setRemoving(undefined)
          }}
          onCancel={() => setRemoving(undefined)}
        />
      )}
    </>
  )
}
