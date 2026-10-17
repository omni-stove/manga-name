import { Button, SegmentedControl, type ThemePreference, useThemePreference } from '@manga/ui'
import { createFileRoute } from '@tanstack/react-router'
import common from '../common.module.css'
import { SignInButton } from '../sign-in'
import { useAuth } from '../use-auth'

export const Route = createFileRoute('/settings')({ component: AppSettings })

const THEMES: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'システム' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]

function AppSettings() {
  const [theme, setTheme] = useThemePreference()
  const { user, signOut } = useAuth()
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
        <dd className={common.actions}>
          {user ? (
            <>
              {`${user.name}（${user.email}）`}
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
        </dd>
        <dt>テーマ</dt>
        <dd>
          <SegmentedControl label="テーマ" value={theme} options={THEMES} onChange={setTheme} />
        </dd>
      </dl>
    </section>
  )
}
