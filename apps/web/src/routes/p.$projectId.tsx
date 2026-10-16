import { Button } from '@manga/ui'
import { createFileRoute, Link, notFound, Outlet, useParams } from '@tanstack/react-router'
import { useStore } from 'zustand'
import { CollaborationBar } from '../collaboration-view'
import { downloadText, exportFileName, exportProjectJson } from '../project-file'
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
  const { projectId } = Route.useParams()
  const { store, collab } = Route.useLoaderData()
  const project = useProject(store)
  const { canUndo, canRedo } = useStore(store.state)
  return (
    <section>
      <header className={styles.header}>
        <h1 className={styles.title}>{project.title || '無題'}</h1>
        <CollaborationBar collab={collab} project={project} />
        <nav className={styles.tabs}>
          <Link to="/p/$projectId" params={{ projectId }} activeOptions={{ exact: true }}>
            ページ
          </Link>
          <Link to="/p/$projectId/characters" params={{ projectId }}>
            キャラクター
          </Link>
          <Link to="/p/$projectId/settings" params={{ projectId }}>
            設定
          </Link>
        </nav>
        <span className={styles.actions}>
          <SaveStatusIndicator store={store} />
          <Button size="small" variant="ghost" disabled={!canUndo} onClick={() => store.undo()}>
            Undo
          </Button>
          <Button size="small" variant="ghost" disabled={!canRedo} onClick={() => store.redo()}>
            Redo
          </Button>
          <Button
            size="small"
            onClick={() => downloadText(exportFileName(project), exportProjectJson(project))}
          >
            JSON 書き出し
          </Button>
        </span>
      </header>
      <Outlet />
    </section>
  )
}

function ProjectNotFound() {
  const { projectId } = useParams({ strict: false })
  return (
    <section>
      <h1>プロジェクトが見つかりません</h1>
      <p>{projectId}</p>
      <Link to="/">プロジェクト一覧へ</Link>
    </section>
  )
}
