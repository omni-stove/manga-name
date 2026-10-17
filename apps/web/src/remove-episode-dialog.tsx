import type { Episode } from '@manga/schema'
import { ConfirmDialog } from '@manga/ui'

/** エピソードの削除を確かめる。ページも一緒に消えるので枚数を出す。Undo で戻せる */
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
      title="エピソードを削除"
      message={`「${episode.title}」とその ${episode.pages.length} ページを削除しますか？`}
      confirmLabel="削除"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
