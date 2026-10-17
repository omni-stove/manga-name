import { Typography, YStack } from '@manga/ui'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import type { RouterContext } from '../router'
import { SideNav } from '../side-nav'
import { Toasts } from '../toasts'
import styles from './root.module.css'

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
})

function RootLayout() {
  return (
    <div className={styles.app}>
      <SideNav />
      <main className={styles.main}>
        <Outlet />
      </main>
      <Toasts />
    </div>
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
