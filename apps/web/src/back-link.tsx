import { Link, type LinkProps } from '@tanstack/react-router'
import { createContext, type ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'
import styles from './back-link.module.css'

/** BackLink を描く先。プロジェクトの画面のツールバーが、保存状態と同じ列に置く */
export const BackLinkSlot = createContext<HTMLElement | null>(null)

/**
 * 一覧から開いた新規作成・詳細の画面の「← 親の画面」のリンク。
 * BackLinkSlot があればそこへ、無ければその場に描く。
 * 矢印は読み上げず、リンクの名前は親の画面の名前だけにする
 */
export function BackLink({
  children,
  ...link
}: Pick<LinkProps, 'to' | 'params'> & { children: ReactNode }) {
  const slot = useContext(BackLinkSlot)
  const element = (
    <Link {...link} className={styles.back}>
      <span aria-hidden>← </span>
      {children}
    </Link>
  )
  return slot ? createPortal(element, slot) : element
}
