import { Button } from '@manga/ui'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import type { RouterContext } from '../router'
import { Toasts } from '../toasts'
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

/**
 * ログイン中のユーザー名とサインアウト。ログインは生成とクラウド保存にだけ要るので、
 * 未ログインの間はヘッダーに入口を置かず、アプリ設定と、ログインが要る操作の失敗表示から入る
 */
function Account() {
  const { user, signOut } = useAuth()
  if (user === null) return null
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
