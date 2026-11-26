import { m } from '@manga/i18n'
import { Typography, XStack, YStack } from '@manga/ui'
import {
  createFileRoute,
  Link,
  notFound,
  Outlet,
  useMatches,
  useParams,
} from '@tanstack/react-router'
import { Breadcrumb, type ProjectScreen, projectTrail } from '../breadcrumb'
import { CollaborationBar } from '../collaboration-view'
import { SaveStatusIndicator } from '../save-status'
import { useProject } from '../use-project'
import styles from './project.module.css'

export const Route = createFileRoute('/p/$projectId')({
  loader: async ({ context, params }) => {
    const store = await context.library.open(params.projectId)
    if (!store) throw notFound()
    return { store, collab: context.library.collaboration(params.projectId) }
  },
  component: ProjectLayout,
  notFoundComponent: ProjectNotFound,
})

/** プロジェクト配下の画面を、ツールバーのパンくず・共同編集者・保存状態と一緒に出す */
function ProjectLayout() {
  const { projectId } = Route.useParams()
  const { store, collab } = Route.useLoaderData()
  const project = useProject(store)
  const screen = useProjectScreen()
  return (
    <section>
      <XStack wrap gap={24} rowGap={8} className={styles.toolbar}>
        <Breadcrumb items={projectTrail(project, projectId, screen)} />
        <CollaborationBar collab={collab} project={project} />
        <XStack as="span" gap={6} className={styles.actions}>
          <SaveStatusIndicator store={store} />
        </XStack>
      </XStack>
      <Outlet />
    </section>
  )
}

/**
 * 開いている子の画面。各画面がパンくずを自分で描くと、ツールバーへ portal するまで初回の描画に出ないので、
 * 子のルートから親が決める
 */
function useProjectScreen(): ProjectScreen {
  const routeId = useMatches({ select: (matches) => matches.at(-1)?.routeId })
  const { episodeId } = useParams({ strict: false })
  switch (routeId) {
    case '/p/$projectId/episodes/$episodeId':
      return { kind: 'episode', episodeId: episodeId ?? '' }
    case '/p/$projectId/episodes/$episodeId_/draft':
      return { kind: 'draft', episodeId: episodeId ?? '' }
    case '/p/$projectId/characters':
      return { kind: 'characters' }
    case '/p/$projectId/characters_/new':
      return { kind: 'newCharacter' }
    default:
      return { kind: 'episodes' }
  }
}

function ProjectNotFound() {
  const { projectId } = useParams({ strict: false })
  return (
    <YStack as="section" gap={16} align="start">
      <Typography variant="title">{m.web_not_found_project()}</Typography>
      <Typography>{projectId}</Typography>
      <Link to="/">{m.web_back_to_project_list()}</Link>
    </YStack>
  )
}
