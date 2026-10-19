import { Link, type LinkProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import styles from './back-link.module.css'

/**
 * 一覧から開いた新規作成・詳細の画面で、見出しの上に置く「← 親の画面」のリンク。
 * 矢印は読み上げず、リンクの名前は親の画面の名前だけにする
 */
export function BackLink({
  children,
  ...link
}: Pick<LinkProps, 'to' | 'params'> & { children: ReactNode }) {
  return (
    <Link {...link} className={styles.back}>
      <span aria-hidden>← </span>
      {children}
    </Link>
  )
}
