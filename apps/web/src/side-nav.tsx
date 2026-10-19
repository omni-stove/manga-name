import { m } from '@manga/i18n'
import { Button, IconButton, Typography, XStack, YStack } from '@manga/ui'
import { Link, type LinkProps, useMatch } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useOpenedProject } from './settings-dialog'
import styles from './side-nav.module.css'
import type { WebProjectStore } from './store/project-store-types'
import { useAuth } from './use-auth'
import { useProject } from './use-project'
import { useStoredFlag } from './use-stored-flag'

/**
 * 画面の左に縦に並べるナビゲーション。プロジェクト一覧、開いているプロジェクトのエピソード・キャラクター・設定、
 * アプリ設定とアカウントを並べる。設定は画面を移らず、今の画面の上にダイアログで開く。既定はアイコンだけの細い帯に畳んでおき、上端のボタンで名前付きの幅に開く。
 * 開閉はブラウザに覚えておき、次に開いたときも同じ幅にする
 */
export function SideNav() {
  const opened = useOpenedProject()
  const editor = useMatch({ from: '/p/$projectId_/pages/$pageId', shouldThrow: false })
  const episode = useMatch({ from: '/p/$projectId/episodes/$episodeId', shouldThrow: false })
  const [expanded, setExpanded] = useStoredFlag('manga.sideNav.expanded', false)
  const collapsed = !expanded
  return (
    <YStack
      as="nav"
      gap={16}
      aria-label={m.web_nav_label()}
      className={styles.nav}
      data-collapsed={collapsed || undefined}
    >
      <XStack justify={collapsed ? 'center' : 'between'}>
        {!collapsed && (
          <Link to="/" className={styles.brand}>
            manga
          </Link>
        )}
        <IconButton
          label={collapsed ? m.web_nav_expand() : m.web_nav_collapse()}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {collapsed ? <ExpandIcon /> : <CollapseIcon />}
        </IconButton>
      </XStack>
      <YStack as="ul" gap={2} className={styles.list}>
        <NavItem
          to="/"
          activeOptions={{ exact: true }}
          icon={<GridIcon />}
          label={m.web_project_list()}
          guide="nav-projects"
        />
        <NavItem to="/onboarding" icon={<SparkIcon />} label={m.web_nav_onboarding()} />
      </YStack>
      {opened && (
        <ProjectItems
          projectId={opened.projectId}
          store={opened.store}
          collapsed={collapsed}
          inEpisodes={editor !== undefined || episode !== undefined}
        />
      )}
      <YStack as="ul" gap={2} className={styles.footer}>
        <NavItem
          to="."
          search={(prev) => ({ ...prev, settings: 'app' })}
          replace
          icon={<GearIcon />}
          label={m.web_app_settings()}
        />
        {!collapsed && <Account />}
      </YStack>
    </YStack>
  )
}

function ProjectItems({
  projectId,
  store,
  collapsed,
  inEpisodes,
}: {
  projectId: string
  store: WebProjectStore
  collapsed: boolean
  inEpisodes: boolean
}) {
  const project = useProject(store)
  return (
    <YStack as="ul" gap={2} className={styles.list} aria-label={project.title || m.untitled()}>
      {!collapsed && (
        <Typography as="li" variant="label" tone="muted" className={styles.project}>
          {project.title || m.untitled()}
        </Typography>
      )}
      <NavItem
        to="/p/$projectId"
        params={{ projectId }}
        // エピソードとエディタはエピソード一覧の下の階層なので、そこにいる間もエピソードを選ばれた状態にする
        activeOptions={{ exact: !inEpisodes }}
        icon={<PagesIcon />}
        label={m.episode()}
        guide="nav-episodes"
      />
      <NavItem
        to="/p/$projectId/characters"
        params={{ projectId }}
        icon={<PersonIcon />}
        label={m.character()}
        guide="nav-characters"
      />
      <NavItem
        to="."
        search={(prev) => ({ ...prev, settings: 'project' })}
        replace
        icon={<SlidersIcon />}
        label={m.web_nav_settings()}
      />
    </YStack>
  )
}

function NavItem({
  icon,
  label,
  guide,
  ...link
}: Pick<LinkProps, 'to' | 'params' | 'search' | 'replace' | 'activeOptions'> & {
  icon: ReactNode
  label: string
  /** オンボーディングの案内が吹き出しを向けるときの目印 */
  guide?: string
}) {
  return (
    <li>
      <Link {...link} className={styles.item} title={label} data-guide={guide}>
        {icon}
        <span className={styles.label}>{label}</span>
      </Link>
    </li>
  )
}

/**
 * ログイン中のユーザー名とサインアウト。ログインは生成とクラウド保存にだけ要るので、
 * 未ログインの間はナビに入口を置かず、アプリ設定と、ログインが要る操作の失敗表示から入る
 */
function Account() {
  const { user, signOut } = useAuth()
  if (user === null) return null
  return (
    <YStack as="li" gap={4} align="start" className={styles.account}>
      <span title={user.email}>{user.name || user.email}</span>
      <Button size="small" variant="ghost" onClick={() => void signOut()}>
        {m.web_sign_out()}
      </Button>
    </YStack>
  )
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={styles.icon}
    >
      {children}
    </svg>
  )
}

const ExpandIcon = () => (
  <Icon>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M9 4v16M13 10l2 2-2 2" />
  </Icon>
)

const CollapseIcon = () => (
  <Icon>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M9 4v16M16 10l-2 2 2 2" />
  </Icon>
)

const GridIcon = () => (
  <Icon>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
  </Icon>
)

const SparkIcon = () => (
  <Icon>
    <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1-5.1-1.9 5.1-1.9z" />
    <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
  </Icon>
)

const PagesIcon = () => (
  <Icon>
    <rect x="5" y="3" width="14" height="18" rx="1" />
    <path d="M5 11h14M12 11v10" />
  </Icon>
)

const PersonIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5" />
  </Icon>
)

const SlidersIcon = () => (
  <Icon>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Icon>
)

const GearIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
  </Icon>
)
