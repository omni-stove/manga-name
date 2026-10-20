import { m } from '@manga/i18n'
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useId,
  useRef,
} from 'react'
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
  /** 開いたときの幅（px）。`undefined` なら `--sidebar-width` に従う */
  width?: number
  /**
   * 渡すと、開いているあいだ内側の縁に幅を変えるつまみを出す。つまみのドラッグか左右キーで
   * 新しい幅を、ダブルクリックで `undefined`（`--sidebar-width` に戻す）を渡す
   */
  onWidthChange?(width: number | undefined): void
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
  width,
  onWidthChange,
  children,
}: SidebarProps) {
  const contentId = useId()
  const collapsed = !expanded
  return (
    <aside
      aria-label={title}
      className={cx(styles.sidebar, className)}
      style={
        width === undefined ? undefined : ({ '--sidebar-width': `${width}px` } as CSSProperties)
      }
      data-side={side}
      data-collapsed={collapsed || undefined}
    >
      {!collapsed && onWidthChange && (
        <ResizeHandle title={title} side={side} width={width} onWidthChange={onWidthChange} />
      )}
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

const MIN_WIDTH = 192
const KEY_STEP = 16

/** 狭めすぎると入力欄が潰れ、広げすぎるとキャンバスが無くなるので、画面の半分までに収める */
function clampWidth(width: number): number {
  return Math.round(
    Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth / 2)),
  )
}

/** サイドバーの内側の縁に重ねる、幅を変えるつまみ */
function ResizeHandle({
  title,
  side,
  width,
  onWidthChange,
}: {
  title: string
  side: 'left' | 'right'
  width: number | undefined
  onWidthChange(width: number | undefined): void
}) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  // 右端のサイドバーは左へ引くほど広がる
  const outward = side === 'left' ? 1 : -1
  // 幅を覚えていないあいだは CSS で決まった今の幅から動かす
  const currentWidth = (element: HTMLElement) =>
    width ?? element.parentElement?.getBoundingClientRect().width ?? MIN_WIDTH

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, width: currentWidth(e.currentTarget) }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    onWidthChange(clampWidth(drag.current.width + (e.clientX - drag.current.x) * outward))
  }
  const onPointerEnd = () => {
    drag.current = null
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const direction = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (direction === 0) return
    e.preventDefault()
    onWidthChange(clampWidth(currentWidth(e.currentTarget) + direction * outward * KEY_STEP))
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: hr は操作できる区切りにならない
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={m.ui_sidebar_resize({ title })}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      tabIndex={0}
      className={styles.resizeHandle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => onWidthChange(undefined)}
      onKeyDown={onKeyDown}
    />
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
