import { Button, Typography, XStack, YStack } from '@manga/ui'
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
    <YStack gap={0} className={styles.app}>
      <XStack as="header" justify="between" className={styles.header}>
        <Link to="/" className={styles.brand}>
          manga
        </Link>
        <XStack as="nav" gap={16} className={styles.nav}>
          <Link to="/settings">アプリ設定</Link>
          <Account />
        </XStack>
      </XStack>
      <main className={styles.main}>
        <Outlet />
      </main>
      <Toasts />
    </YStack>
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
    <XStack as="span">
      <span title={user.email}>{user.name}</span>
      <Button size="small" variant="ghost" onClick={() => void signOut()}>
        サインアウト
      </Button>
    </XStack>
  )
}

function NotFound() {
  return (
    <YStack as="section" gap={16} align="start">
      <Typography variant="title">ページが見つかりません</Typography>
      <Link to="/">プロジェクト一覧へ</Link>
    </YStack>
  )
}
