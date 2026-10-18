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
import { settingsPatch } from './project-ops'
import styles from './project-settings.module.css'
import { SharingPanel } from './sharing-panel'
import { SignInButton } from './sign-in'
import type { WebProjectStore } from './store/project-store'
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
  const actions = <Button onClick={close}>閉じる</Button>
  if (settings === 'app')
    return (
      <Dialog key={settings} title="アプリ設定" onClose={close} actions={actions}>
        <AppSettings />
      </Dialog>
    )
  if (settings === 'project' && opened)
    return (
      <Dialog
        key={settings}
        title="プロジェクト設定"
        onClose={close}
        actions={actions}
        className={styles.dialog}
      >
        <ProjectSettingsForm {...opened} />
      </Dialog>
    )
  return null
}

const THEMES: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'システム' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]

function AppSettings() {
  const [theme, setTheme] = useThemePreference()
  const { user, signOut } = useAuth()
  return (
    <YStack gap={16} align="start">
      <Typography tone="muted">設定の保存はここに入る。</Typography>
      <dl className={common.fields}>
        <dt>ストレージ</dt>
        <dd>memory / indexeddb</dd>
        <dt>AI プロキシの URL</dt>
        <dd>未設定</dd>
        <dt>アカウント</dt>
        <XStack as="dd" wrap>
          {user ? (
            <>
              {user.email}
              <Button size="small" variant="ghost" onClick={() => void signOut()}>
                サインアウト
              </Button>
            </>
          ) : (
            <>
              未ログイン（ローカルモード）。AI の生成とクラウド保存にはログインが要ります
              <SignInButton size="small" />
            </>
          )}
        </XStack>
        {user && (
          <>
            <dt>表示名</dt>
            <dd>
              <DisplayNameForm key={user.id} name={user.name} />
            </dd>
          </>
        )}
        <dt>テーマ</dt>
        <dd>
          <SegmentedControl label="テーマ" value={theme} options={THEMES} onChange={setTheme} />
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
  const { direction, pageSize, dpi, style } = project.settings

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
          const negative = text('negative')
          const next: Pick<ProjectSettings, 'direction' | 'pageSize' | 'dpi' | 'style'> = {
            direction: text('direction') === 'ltr' ? 'ltr' : 'rtl',
            pageSize: { w: number('w'), h: number('h'), unit: 'mm' },
            dpi: number('dpi'),
            style: negative ? { prompt: text('prompt'), negative } : { prompt: text('prompt') },
          }
          const title = text('title')
          apply('プロジェクト設定を変更', (p) => {
            const patch = settingsPatch(p.settings, next)
            if (title !== p.title) patch.unshift({ op: 'replace', path: '/title', value: title })
            return patch
          })
        }}
      >
        <Input label="タイトル" name="title" defaultValue={project.title} />
        <Select label="読む方向" name="direction" defaultValue={direction}>
          <option value="rtl">右から左（rtl）</option>
          <option value="ltr">左から右（ltr）</option>
        </Select>
        <FieldGroup label="判型（mm）">
          <XStack className={styles.size}>
            <Input
              label="幅"
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
              label="高さ"
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
        <Input label="dpi" name="dpi" type="number" min="1" step="1" required defaultValue={dpi} />
        <TextArea label="スタイル" name="prompt" rows={3} defaultValue={style.prompt} />
        <TextArea
          label="除外するもの"
          name="negative"
          rows={2}
          defaultValue={style.negative ?? ''}
        />
        <Button type="submit" variant="primary" disabled={role !== 'owner' && role !== 'editor'}>
          保存
        </Button>
      </form>
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
      <Typography variant="heading">共有</Typography>
      {/* key で作り直すのは、SharingPanel が最初に読んだプロジェクトの参加者を持ち続けるため */}
      <SharingPanel key={projectId} projectId={projectId} sharing={sharing} />
    </YStack>
  )
}
