import { createFileRoute, Link, notFound, Outlet, useParams } from '@tanstack/react-router'
import { useStore } from 'zustand'
import { CollaborationBar } from '../collaboration-view'
import { downloadText, exportFileName, exportProjectJson } from '../project-file'
import type { SaveStatus } from '../store/project-store'
import { useProject } from '../use-project'

export const Route = createFileRoute('/p/$projectId')({
  loader: async ({ context, params }) => {
    const store = await context.library.open(params.projectId)
    if (!store) throw notFound()
    return { store, collab: context.library.collaboration(params.projectId) }
  },
  component: ProjectLayout,
  notFoundComponent: ProjectNotFound,
})

const SAVE_STATUS: Record<SaveStatus, string> = {
  saved: '保存済み',
  pending: '未保存',
  saving: '保存中…',
  error: '保存に失敗しました',
}

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const { store, collab } = Route.useLoaderData()
  const project = useProject(store)
  const { canUndo, canRedo, saveStatus, saveError } = useStore(store.state)
  return (
    <section>
      <header className="project-header">
        <h1>{project.title || '無題'}</h1>
        <CollaborationBar collab={collab} project={project} />
        <nav className="tabs">
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
        <span className="toolbar-actions">
          <span
            className={saveStatus === 'error' ? 'save-status error' : 'save-status'}
            title={saveError instanceof Error ? saveError.message : undefined}
          >
            {SAVE_STATUS[saveStatus]}
          </span>
          {saveStatus === 'error' && (
            <button type="button" onClick={() => void store.flush()}>
              再保存
            </button>
          )}
          <button type="button" disabled={!canUndo} onClick={() => store.undo()}>
            Undo
          </button>
          <button type="button" disabled={!canRedo} onClick={() => store.redo()}>
            Redo
          </button>
          <button
            type="button"
            onClick={() => downloadText(exportFileName(project), exportProjectJson(project))}
          >
            JSON 書き出し
          </button>
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
