import { Button, IconButton, Typography, XStack, YStack } from '@manga/ui'
import { Link, type LinkProps, useMatch } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'
import styles from './side-nav.module.css'
import type { WebProjectStore } from './store/project-store'
import { useAuth } from './use-auth'
import { useProject } from './use-project'

/**
 * 画面の左に縦に並べるナビゲーション。プロジェクト一覧、開いているプロジェクトのエピソード・キャラクター・設定、
 * アプリ設定とアカウントを並べる。既定はアイコンだけの細い帯に畳んでおき、上端のボタンで名前付きの幅に開く。
 * 開閉はブラウザに覚えておき、次に開いたときも同じ幅にする
 */
export function SideNav() {
  const project = useMatch({ from: '/p/$projectId', shouldThrow: false })
  const editor = useMatch({ from: '/p/$projectId_/pages/$pageId', shouldThrow: false })
  const episode = useMatch({ from: '/p/$projectId/episodes/$episodeId', shouldThrow: false })
  const opened = project ?? editor
  const [expanded, setExpanded] = useExpanded()
  const collapsed = !expanded
  return (
    <YStack
      as="nav"
      gap={16}
      aria-label="ナビゲーション"
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
          label={collapsed ? 'ナビゲーションを開く' : 'ナビゲーションを畳む'}
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
          label="プロジェクト一覧"
        />
      </YStack>
      {opened?.loaderData && (
        <ProjectItems
          projectId={opened.params.projectId}
          store={opened.loaderData.store}
          collapsed={collapsed}
          inEpisodes={editor !== undefined || episode !== undefined}
        />
      )}
      <YStack as="ul" gap={2} className={styles.footer}>
        <NavItem to="/settings" icon={<GearIcon />} label="アプリ設定" />
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
    <YStack as="ul" gap={2} className={styles.list} aria-label={project.title || '無題'}>
      {!collapsed && (
        <Typography as="li" variant="label" tone="muted" className={styles.project}>
          {project.title || '無題'}
        </Typography>
      )}
      <NavItem
        to="/p/$projectId"
        params={{ projectId }}
        // エピソードとエディタはエピソード一覧の下の階層なので、そこにいる間もエピソードを選ばれた状態にする
        activeOptions={{ exact: !inEpisodes }}
        icon={<PagesIcon />}
        label="エピソード"
      />
      <NavItem
        to="/p/$projectId/characters"
        params={{ projectId }}
        icon={<PersonIcon />}
        label="キャラクター"
      />
      <NavItem
        to="/p/$projectId/settings"
        params={{ projectId }}
        icon={<SlidersIcon />}
        label="設定"
      />
    </YStack>
  )
}

const EXPANDED_KEY = 'manga.sideNav.expanded'

/** ナビを開いているか。localStorage に覚え、覚えが無ければ畳んだ状態から始める */
function useExpanded(): [boolean, (expanded: boolean) => void] {
  const [expanded, setExpanded] = useState(() => readStorage() === 'true')
  return [
    expanded,
    (next) => {
      setExpanded(next)
      writeStorage(String(next))
    },
  ]
}

// ストレージを塞いだブラウザでは参照だけで SecurityError になるので、覚えられないまま動かす
function readStorage(): string | null {
  try {
    return localStorage.getItem(EXPANDED_KEY)
  } catch {
    return null
  }
}

function writeStorage(value: string): void {
  try {
    localStorage.setItem(EXPANDED_KEY, value)
  } catch {}
}

function NavItem({
  icon,
  label,
  ...link
}: Pick<LinkProps, 'to' | 'params' | 'activeOptions'> & { icon: ReactNode; label: string }) {
  return (
    <li>
      <Link {...link} className={styles.item} title={label}>
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
      <span title={user.email}>{user.name}</span>
      <Button size="small" variant="ghost" onClick={() => void signOut()}>
        サインアウト
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
