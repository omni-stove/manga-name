import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({ component: AppSettings })

function AppSettings() {
  return (
    <section>
      <h1>アプリ設定</h1>
      <p className="placeholder">設定の保存はここに入る。</p>
      <dl className="fields">
        <dt>ストレージ</dt>
        <dd>memory / indexeddb</dd>
        <dt>AI プロキシの URL</dt>
        <dd>未設定</dd>
        <dt>アクセストークン</dt>
        <dd>未設定</dd>
        <dt>テーマ</dt>
        <dd>system</dd>
      </dl>
    </section>
  )
}
