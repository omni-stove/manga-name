import type { ID } from '@manga/schema'
import { Button, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import common from '../common.module.css'
import { PageThumbnail } from '../page-thumbnail'
import { addEpisodePatch } from '../project-ops'
import { useApplyPatch, useProject } from '../use-project'
import { useUndoShortcuts } from '../use-undo-shortcuts'
import styles from './pages.module.css'

export const Route = createFileRoute('/p/$projectId/')({ component: EpisodeList })

const projectRoute = getRouteApi('/p/$projectId')

/** エピソードのカードを並べる。ページの追加や下書きはエピソードを開いた先で行う */
function EpisodeList() {
  const { projectId } = Route.useParams()
  const { store } = projectRoute.useLoaderData()
  const { library } = Route.useRouteContext()
  const project = useProject(store)
  const { apply, error } = useApplyPatch(store)
  const navigate = useNavigate()
  useUndoShortcuts(store)

  // 足した話は空なので、そのまま開いてページを足せるようにする
  const addEpisode = () => {
    let added: ID | undefined
    const ok = apply('エピソードを追加', (p) => {
      const { patch, episode } = addEpisodePatch(p)
      added = episode.id
      return patch
    })
    if (ok && added)
      void navigate({
        to: '/p/$projectId/episodes/$episodeId',
        params: { projectId, episodeId: added },
      })
  }

  return (
    <YStack gap={8}>
      <XStack wrap gap={12} className={common.toolbar}>
        <Typography variant="heading">エピソード</Typography>
        <Button onClick={addEpisode}>エピソードを追加</Button>
      </XStack>
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
      {project.episodes.length === 0 && (
        <Typography tone="muted">エピソードがありません。</Typography>
      )}
      <ol className={`${common.cards} ${styles.pages}`}>
        {project.episodes.map((episode) => {
          const first = episode.pages[0]
          return (
            <YStack as="li" gap={6} key={episode.id} className={common.card}>
              <Link
                to="/p/$projectId/episodes/$episodeId"
                params={{ projectId, episodeId: episode.id }}
                className={common.cardLink}
              >
                <YStack gap={4}>
                  {first ? (
                    <PageThumbnail
                      page={first}
                      pageSize={project.settings.pageSize}
                      resolveAsset={library.resolveAsset}
                    />
                  ) : (
                    <div
                      className={styles.blank}
                      style={{
                        aspectRatio: `${project.settings.pageSize.w} / ${project.settings.pageSize.h}`,
                      }}
                    />
                  )}
                  <strong>{episode.title}</strong>
                </YStack>
              </Link>
              <Typography as="small" variant="caption" tone="muted">
                {`${episode.pages.length} ページ`}
              </Typography>
            </YStack>
          )
        })}
      </ol>
    </YStack>
  )
}
