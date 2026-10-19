import { m } from '@manga/i18n'
import { Typography, YStack } from '@manga/ui'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { DisplayNameDialog } from '../display-name'
import { TourGuide } from '../onboarding/tour-guide'
import type { RouterContext } from '../router-context'
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
      <TourGuide />
    </div>
  )
}

function NotFound() {
  return (
    <YStack as="section" gap={16} align="start">
      <Typography variant="title">{m.web_not_found_page()}</Typography>
      <Link to="/">{m.web_back_to_project_list()}</Link>
    </YStack>
  )
}
