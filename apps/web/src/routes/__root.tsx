import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import type { RouterContext } from '../router'
import { Toasts } from '../toasts'
import styles from './root.module.css'

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
})

function RootLayout() {
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          manga
        </Link>
        <nav className={styles.nav}>
          <Link to="/settings">アプリ設定</Link>
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <Toasts />
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
