import { m } from '@manga/i18n'
import type { ID, ProjectSettings } from '@manga/schema'
import {
  Button,
  Dialog,
  FieldGroup,
  Input,
  SegmentedControl,
  Select,
  TextArea,
  type ThemePreference,
  Typography,
  useThemePreference,
  XStack,
  YStack,
} from '@manga/ui'
import { useMatch, useNavigate, useRouteContext, useSearch } from '@tanstack/react-router'
import common from './common.module.css'
import { DisplayNameForm } from './display-name'
import { characterDesignPatch, settingsPatch } from './project-ops'
import styles from './project-settings.module.css'
import { SharingPanel } from './sharing-panel'
import { SignInButton } from './sign-in'
import type { WebProjectStore } from './store/project-store-types'
import { useAuth } from './use-auth'
import { useApplyPatch, useProject } from './use-project'

/** 開いている設定のダイアログ。URL の `?settings=` に持ち、リロードやリンクでも同じダイアログを開く */
export type SettingsSearch = { settings?: 'app' | 'project' }

export const validateSettingsSearch = (search: Record<string, unknown>): SettingsSearch =>
  search.settings === 'app' || search.settings === 'project' ? { settings: search.settings } : {}

/** 開いているプロジェクト。エピソード以下の画面とエディタで、ルートが別の木にあるので両方から探す */
export function useOpenedProject(): { projectId: ID; store: WebProjectStore } | undefined {
  const project = useMatch({ from: '/p/$projectId', shouldThrow: false })
  const editor = useMatch({ from: '/p/$projectId_/pages/$pageId', shouldThrow: false })
  const opened = project ?? editor
  return (
    opened?.loaderData && { projectId: opened.params.projectId, store: opened.loaderData.store }
  )
}

/**
 * アプリ設定とプロジェクト設定のモーダル。今の画面の上に重ね、閉じればその画面に戻る。
 * 開閉は履歴に積まず置き換えるので、ブラウザの戻るは設定の前の画面へ戻る
 */
export function SettingsDialog() {
  const { settings } = useSearch({ from: '__root__' })
  const navigate = useNavigate()
  const opened = useOpenedProject()
  const close = () =>
    void navigate({
      to: '.',
      search: ({ settings: _, ...rest }) => rest,
      replace: true,
    })
  const actions = <Button onClick={close}>{m.close()}</Button>
  if (settings === 'app')
    return (
      <Dialog key={settings} title={m.web_app_settings()} onClose={close} actions={actions}>
        <AppSettings />
      </Dialog>
    )
  if (settings === 'project' && opened)
    return (
      <Dialog
        key={settings}
        title={m.web_project_settings()}
        onClose={close}
        actions={actions}
        className={styles.dialog}
      >
        <ProjectSettingsForm {...opened} />
      </Dialog>
    )
  return null
}

const themes = (): readonly { value: ThemePreference; label: string }[] => [
  { value: 'system', label: m.web_settings_theme_system() },
  { value: 'light', label: m.web_settings_theme_light() },
  { value: 'dark', label: m.web_settings_theme_dark() },
]

function AppSettings() {
  const [theme, setTheme] = useThemePreference()
  const { user, signOut } = useAuth()
  return (
    <YStack gap={16} align="start">
      <Typography tone="muted">{m.web_settings_placeholder()}</Typography>
      <dl className={common.fields}>
        <dt>{m.web_settings_storage()}</dt>
        <dd>memory / indexeddb</dd>
        <dt>{m.web_settings_ai_proxy_url()}</dt>
        <dd>{m.web_settings_not_set()}</dd>
        <dt>{m.web_settings_account()}</dt>
        <XStack as="dd" wrap>
          {user ? (
            <>
              {user.email}
              <Button size="small" variant="ghost" onClick={() => void signOut()}>
                {m.web_sign_out()}
              </Button>
            </>
          ) : (
            <>
              {m.web_settings_signed_out()}
              <SignInButton size="small" />
            </>
          )}
        </XStack>
        {user && (
          <>
            <dt>{m.web_display_name_label()}</dt>
            <dd>
              <DisplayNameForm key={user.id} name={user.name} />
            </dd>
          </>
        )}
        <dt>{m.web_settings_theme()}</dt>
        <dd>
          <SegmentedControl
            label={m.web_settings_theme()}
            value={theme}
            options={themes()}
            onChange={setTheme}
          />
        </dd>
      </dl>
    </YStack>
  )
}

/** 空欄は 0 ではなく NaN にして、スキーマに不正な値として弾かせる */
const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text))

function ProjectSettingsForm({ projectId, store }: { projectId: ID; store: WebProjectStore }) {
  const { library, sharing } = useRouteContext({ from: '__root__' })
  const role = library.role(projectId) ?? 'owner'
  const project = useProject(store)
  const { apply, error } = useApplyPatch(store)
  const { direction, pageSize, dpi, characterDesign } = project.settings

  return (
    <YStack gap={16}>
      <form
        // Undo や他の画面での変更の後に、入力欄を保存済みの値へ戻すため、内容が変わったら作り直す
        key={JSON.stringify([project.title, project.settings])}
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          const data = new FormData(e.currentTarget)
          const text = (key: string) => String(data.get(key) ?? '')
          const number = (key: string) => toNumber(text(key))
          const next: Pick<ProjectSettings, 'direction' | 'pageSize' | 'dpi'> = {
            direction: text('direction') === 'ltr' ? 'ltr' : 'rtl',
            pageSize: { w: number('w'), h: number('h'), unit: 'mm' },
            dpi: number('dpi'),
          }
          const title = text('title')
          const design = text('characterDesign')
          apply(m.web_settings_change_project(), (p) => {
            const patch = [
              ...settingsPatch(p.settings, next),
              ...characterDesignPatch(p.settings, design),
            ]
            if (title !== p.title) patch.unshift({ op: 'replace', path: '/title', value: title })
            return patch
          })
        }}
      >
        <Input label={m.project_title()} name="title" defaultValue={project.title} />
        <Select label={m.project_settings_direction()} name="direction" defaultValue={direction}>
          <option value="rtl">{m.project_settings_direction_rtl()}</option>
          <option value="ltr">{m.project_settings_direction_ltr()}</option>
        </Select>
        <FieldGroup label={m.project_settings_page_size()}>
          <XStack className={styles.size}>
            <Input
              label={m.project_settings_page_size_w()}
              hideLabel
              name="w"
              type="number"
              min="1"
              step="any"
              required
              defaultValue={pageSize.w}
            />
            ×
            <Input
              label={m.project_settings_page_size_h()}
              hideLabel
              name="h"
              type="number"
              min="1"
              step="any"
              required
              defaultValue={pageSize.h}
            />
          </XStack>
        </FieldGroup>
        <Input
          label={m.web_dpi()}
          name="dpi"
          type="number"
          min="1"
          step="1"
          required
          defaultValue={dpi}
        />
        <TextArea
          label={m.project_settings_character_design()}
          name="characterDesign"
          hint={m.web_settings_character_design_hint()}
          placeholder={m.web_settings_character_design_placeholder()}
          rows={3}
          defaultValue={characterDesign}
        />
        <Button type="submit" variant="primary" disabled={role !== 'owner' && role !== 'editor'}>
          {m.save()}
        </Button>
      </form>
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
      <Typography variant="heading">{m.web_settings_sharing()}</Typography>
      {/* key で作り直すのは、SharingPanel が最初に読んだプロジェクトの参加者を持ち続けるため */}
      <SharingPanel key={projectId} projectId={projectId} sharing={sharing} />
    </YStack>
  )
}
