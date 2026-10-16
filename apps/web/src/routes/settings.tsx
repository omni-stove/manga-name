import { SegmentedControl, type ThemePreference, useThemePreference } from '@manga/ui'
import { createFileRoute } from '@tanstack/react-router'
import common from '../common.module.css'
import { useAuth } from '../use-auth'

export const Route = createFileRoute('/settings')({ component: AppSettings })

const THEMES: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'システム' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]

function AppSettings() {
  const [theme, setTheme] = useThemePreference()
  const { user } = useAuth()
  return (
    <section>
      <h1>アプリ設定</h1>
      <p className={common.placeholder}>設定の保存はここに入る。</p>
      <dl className={common.fields}>
        <dt>ストレージ</dt>
        <dd>memory / indexeddb</dd>
        <dt>AI プロキシの URL</dt>
        <dd>未設定</dd>
        <dt>アカウント</dt>
        <dd>{user ? `${user.name}（${user.email}）` : '未ログイン（ローカルモード）'}</dd>
        <dt>テーマ</dt>
        <dd>
          <SegmentedControl label="テーマ" value={theme} options={THEMES} onChange={setTheme} />
        </dd>
      </dl>
    </section>
  )
}
