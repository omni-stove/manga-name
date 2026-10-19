import { m } from '@manga/i18n'
import type { Episode } from '@manga/schema'
import { ConfirmDialog } from '@manga/ui'

/** エピソードの削除を確かめる。ページも一緒に消えるので枚数を出す */
export function RemoveEpisodeDialog({
  episode,
  onConfirm,
  onCancel,
}: {
  episode: Episode
  onConfirm(): void
  onCancel(): void
}) {
  return (
    <ConfirmDialog
      title={m.web_episode_remove()}
      message={m.web_episodes_remove_message({
        title: episode.title,
        count: episode.pages.length,
      })}
      confirmLabel={m.remove()}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
