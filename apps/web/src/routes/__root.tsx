import { Button } from '@manga/ui'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import type { RouterContext } from '../router'
import { toasts, Toasts } from '../toasts'
import { useAuth } from '../use-auth'
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
          <Account />
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <Toasts />
    </div>
  )
}

/** ログイン中ならユーザー名とサインアウト、未ログインならログイン */
function Account() {
  const { user, signIn, signOut } = useAuth()
  if (user === null) {
    return (
      <Button
        size="small"
        onClick={() =>
          signIn().catch((e: unknown) => toasts.push(`ログインできません: ${String(e)}`))
        }
      >
        ログイン
      </Button>
    )
  }
  return (
    <span className={styles.account}>
      <span title={user.email}>{user.name}</span>
      <Button size="small" variant="ghost" onClick={() => void signOut()}>
        サインアウト
      </Button>
    </span>
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
