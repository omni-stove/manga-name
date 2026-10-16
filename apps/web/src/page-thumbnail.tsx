import type { Page, ProjectSettings } from '@manga/schema'
import styles from './page-thumbnail.module.css'

/** ページのコマ割りを判型の縦横比で描く。絵が選ばれたコマは塗る */
export function PageThumbnail({
  page,
  pageSize,
}: {
  page: Page
  pageSize: ProjectSettings['pageSize']
}) {
  const { w, h } = pageSize
  return (
    <svg className={styles.thumbnail} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="コマ割り">
      <rect width={w} height={h} className={styles.paper} />
      {page.panels.map((panel) => (
        <rect
          key={panel.id}
          x={panel.rect.x * w}
          y={panel.rect.y * h}
          width={panel.rect.w * w}
          height={panel.rect.h * h}
          className={styles.panel}
          data-art={panel.artId !== undefined}
        />
      ))}
    </svg>
  )
}
