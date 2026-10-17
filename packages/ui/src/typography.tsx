import type { ElementType, HTMLAttributes } from 'react'
import { cx } from './cx'
import styles from './typography.module.css'

/** 文字の段階。body は大きさを親から継承する */
export type TypographyVariant = 'title' | 'heading' | 'subheading' | 'body' | 'caption' | 'label'

export interface TypographyProps extends HTMLAttributes<HTMLElement> {
  /** 描画する要素。既定は p */
  as?: ElementType
  /** 既定は body */
  variant?: TypographyVariant
  /** 文字の色。alert は改行を保って出す */
  tone?: 'default' | 'muted' | 'alert'
  /** 段階の太さを上書きする */
  weight?: 'regular' | 'medium' | 'bold'
}

/** 文字。外側の余白を持たないので、間隔は並べる側の Stack で決める */
export function Typography({
  as: Tag = 'p',
  variant = 'body',
  tone = 'default',
  weight,
  className,
  ...rest
}: TypographyProps) {
  return (
    <Tag
      className={cx(
        styles.text,
        styles[variant],
        tone !== 'default' && styles[tone],
        weight && styles[weight],
        className,
      )}
      {...rest}
    />
  )
}
