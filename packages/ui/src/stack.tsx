import type { AllHTMLAttributes, CSSProperties, ElementType } from 'react'
import { cx } from './cx'
import styles from './stack.module.css'

/** tokens.css の --space-* の段階。0 は間を空けない */
export type Space = 0 | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 20 | 24 | 32

// as で form や fieldset、button にもなるので、要素ごとの属性も受け取れるようにする
interface StackProps extends Omit<AllHTMLAttributes<HTMLElement>, 'as' | 'wrap'> {
  /** 描画する要素。既定は div */
  as?: ElementType
  /** 子の間隔。既定は 8 */
  gap?: Space
  /** 並びと直交する向きの揃え */
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
  /** 並びの向きの揃え。between は両端に寄せて間を空ける */
  justify?: 'start' | 'center' | 'end' | 'between'
}

export interface XStackProps extends StackProps {
  /** 幅が足りないとき次の行に折り返す */
  wrap?: boolean
  /** 折り返した行の間隔。既定は gap と同じ */
  rowGap?: Space
}

// 揃えと間隔は CSS 変数で渡す。変数は子に継承されるので、入れ子の Stack が親の値を拾わないよう毎回すべて設定する
const space = (s: Space) => (s === 0 ? '0' : `var(--space-${s})`)

/** 子を横に並べる。align の既定は center */
export function XStack({
  as: Tag = 'div',
  gap = 8,
  rowGap,
  align = 'center',
  justify = 'start',
  wrap,
  className,
  style,
  ...rest
}: XStackProps) {
  return (
    <Tag
      className={cx(styles.x, wrap && styles.wrap, className)}
      style={
        {
          '--_gap': space(gap),
          '--_row-gap': space(rowGap ?? gap),
          '--_align': align,
          '--_justify': justifyValue[justify],
          ...style,
        } as CSSProperties
      }
      {...rest}
    />
  )
}

/** 子を縦に並べる。align の既定は stretch */
export function YStack({
  as: Tag = 'div',
  gap = 8,
  align = 'stretch',
  justify = 'start',
  className,
  style,
  ...rest
}: StackProps) {
  return (
    <Tag
      className={cx(styles.y, className)}
      style={
        {
          '--_gap': space(gap),
          '--_align': align,
          '--_justify': justifyValue[justify],
          ...style,
        } as CSSProperties
      }
      {...rest}
    />
  )
}

const justifyValue = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
} as const
