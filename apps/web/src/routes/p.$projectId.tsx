import { Button, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, Link, notFound, Outlet, useParams } from '@tanstack/react-router'
import { useStore } from 'zustand'
import { CollaborationBar } from '../collaboration-view'
import { exportFileName, exportProjectJson, PROJECT_FILE_FILTERS } from '../project-file'
import { errorMessage } from '../route-error'
import { saveFile } from '../save-file'
import { SaveStatusIndicator } from '../save-status'
import { toasts } from '../toasts'
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
  const { projectId } = Route.useParams()
  const { store, collab } = Route.useLoaderData()
  const project = useProject(store)
  const { canUndo, canRedo } = useStore(store.state)
  return (
    <section>
      <XStack as="header" wrap gap={24} rowGap={8} className={styles.header}>
        <Typography variant="heading">{project.title || '無題'}</Typography>
        <CollaborationBar collab={collab} project={project} />
        <XStack as="nav" gap={4} align="stretch" className={styles.tabs}>
          <Link to="/p/$projectId" params={{ projectId }} activeOptions={{ exact: true }}>
            ページ
          </Link>
          <Link to="/p/$projectId/characters" params={{ projectId }}>
            キャラクター
          </Link>
          <Link to="/p/$projectId/settings" params={{ projectId }}>
            設定
          </Link>
        </XStack>
        <XStack as="span" gap={6} className={styles.actions}>
          <SaveStatusIndicator store={store} />
          <Button size="small" variant="ghost" disabled={!canUndo} onClick={() => store.undo()}>
            Undo
          </Button>
          <Button size="small" variant="ghost" disabled={!canRedo} onClick={() => store.redo()}>
            Redo
          </Button>
          <Button
            size="small"
            onClick={() =>
              void saveFile(
                new Blob([exportProjectJson(project)], { type: 'application/json' }),
                exportFileName(project),
                PROJECT_FILE_FILTERS,
              ).catch((e: unknown) => toasts.push(`書き出せません: ${errorMessage(e)}`))
            }
          >
            JSON 書き出し
          </Button>
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
