import { Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, Link, notFound, Outlet, useParams } from '@tanstack/react-router'
import { CollaborationBar } from '../collaboration-view'
import { HistoryButtons } from '../history-buttons'
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

function ProjectLayout() {
  const { store, collab } = Route.useLoaderData()
  const project = useProject(store)
  return (
    <section>
      <XStack wrap gap={24} rowGap={8} className={styles.toolbar}>
        <HistoryButtons store={store} />
        <CollaborationBar collab={collab} project={project} />
        <XStack as="span" gap={6} className={styles.actions}>
          <SaveStatusIndicator store={store} />
        </XStack>
      </XStack>
      <Outlet />
    </section>
  )
}

function ProjectNotFound() {
  const { projectId } = useParams({ strict: false })
  return (
    <YStack as="section" gap={16} align="start">
      <Typography variant="title">プロジェクトが見つかりません</Typography>
      <Typography>{projectId}</Typography>
      <Link to="/">プロジェクト一覧へ</Link>
    </YStack>
  )
}
