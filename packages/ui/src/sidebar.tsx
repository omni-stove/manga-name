import { m } from '@manga/i18n'
import { type ReactNode, useId } from 'react'
import { IconButton } from './button'
import { cx } from './cx'
import styles from './sidebar.module.css'
import { XStack } from './stack'
import { Typography } from './typography'

interface SidebarProps {
  /** 見出し。畳んでも領域と開閉ボタンの名前として読み上げる */
  title: string
  /** 画面のどちらの端に置くか。境界線と開閉アイコンの向きが変わる */
  side: 'left' | 'right'
  expanded: boolean
  onExpandedChange(expanded: boolean): void
  /** 開いたときの幅は `--sidebar-width` で渡す。既定は 20rem */
  className?: string
  children: ReactNode
}

/**
 * 画面の端に置く、見出しと開閉ボタンつきの縦長の領域。`children` は見出しの下でスクロールする。
 * 畳むと開閉ボタンだけの細い帯になる。開閉の状態は使う側が持つ
 */
export function Sidebar({
  title,
  side,
  expanded,
  onExpandedChange,
  className,
  children,
}: SidebarProps) {
  const contentId = useId()
  const collapsed = !expanded
  return (
    <aside
      aria-label={title}
      className={cx(styles.sidebar, className)}
      data-side={side}
      data-collapsed={collapsed || undefined}
    >
      <XStack justify={collapsed ? 'center' : 'between'} className={styles.header}>
        {!collapsed && (
          <Typography variant="label" tone="muted">
            {title}
          </Typography>
        )}
        <IconButton
          label={collapsed ? m.ui_sidebar_expand({ title }) : m.ui_sidebar_collapse({ title })}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => onExpandedChange(!expanded)}
        >
          <ToggleIcon side={side} pointsOut={collapsed} />
        </IconButton>
      </XStack>
      {/* 畳んでも中身を描いたままにし、details の開閉や入力中の値を開き直したときに残す */}
      <div id={contentId} hidden={collapsed} className={styles.content}>
        {children}
      </div>
    </aside>
  )
}

/** 端に寄せた仕切りと矢印。`pointsOut` なら画面の内側へ開く向き */
function ToggleIcon({ side, pointsOut }: { side: 'left' | 'right'; pointsOut: boolean }) {
  const divider = side === 'left' ? 9 : 15
  const inward = side === 'left' ? 1 : -1
  const tip = divider + inward * (pointsOut ? 6 : 4)
  const tail = divider + inward * (pointsOut ? 4 : 6)
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
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d={`M${divider} 4v16M${tail} 10L${tip} 12L${tail} 14`} />
    </svg>
  )
}
