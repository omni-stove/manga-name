import { SegmentedControl, type ThemePreference, useThemePreference } from '@manga/ui'
import { createFileRoute } from '@tanstack/react-router'
import common from '../common.module.css'

export const Route = createFileRoute('/settings')({ component: AppSettings })

const THEMES: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'システム' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]

function AppSettings() {
  const [theme, setTheme] = useThemePreference()
  return (
    <section>
      <h1>アプリ設定</h1>
      <p className={common.placeholder}>設定の保存はここに入る。</p>
      <dl className={common.fields}>
        <dt>ストレージ</dt>
        <dd>memory / indexeddb</dd>
        <dt>AI プロキシの URL</dt>
        <dd>未設定</dd>
        <dt>アクセストークン</dt>
        <dd>未設定</dd>
        <dt>テーマ</dt>
        <dd>
          <SegmentedControl label="テーマ" value={theme} options={THEMES} onChange={setTheme} />
        </dd>
      </dl>
    </section>
  )
}
