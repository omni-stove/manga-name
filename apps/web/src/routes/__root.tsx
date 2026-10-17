import { Typography, YStack } from '@manga/ui'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { DisplayNameDialog } from '../display-name'
import type { RouterContext } from '../router'
import { SettingsDialog, validateSettingsSearch } from '../settings-dialog'
import { SideNav } from '../side-nav'
import { Toasts } from '../toasts'
import styles from './root.module.css'

export const Route = createRootRouteWithContext<RouterContext>()({
  validateSearch: validateSettingsSearch,
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
      <SettingsDialog />
      <DisplayNameDialog />
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
