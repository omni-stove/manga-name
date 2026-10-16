import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import type { RouterContext } from '../router'

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
})

function RootLayout() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          manga
        </Link>
        <nav>
          <Link to="/settings">アプリ設定</Link>
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

function NotFound() {
  return (
    <section>
      <h1>ページが見つかりません</h1>
      <Link to="/">プロジェクト一覧へ</Link>
    </section>
  )
}
