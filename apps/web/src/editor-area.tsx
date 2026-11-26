import type { ReactNode } from 'react'
import styles from './editor-area.module.css'

/**
 * 編集画面のうち、まとめて使えるようにしたり止めたりする領域。
 * `navigation` はページ送り、`canvas` はキャンバスの操作と参考画像の取り込み、`inspector` は要素一覧と要素とページの編集とページの脚本、
 * `generate` は「このページを全部生成」と「生成済みも含める」
 */
export type EditorArea =
  | 'navigation'
  | 'history'
  | 'tools'
  | 'layers'
  | 'export'
  | 'canvas'
  | 'inspector'
  | 'generate'

/** `open` でなければ中身を見た目そのままで押せなくし、フォーカスも当てない */
export function Area({ open, children }: { open: boolean; children: ReactNode }) {
  if (open) return children
  return (
    <fieldset disabled inert className={styles.locked}>
      {children}
    </fieldset>
  )
}
