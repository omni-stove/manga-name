import { createFileRoute, Link, notFound, useParams } from '@tanstack/react-router'
import { useStore } from 'zustand'
import { findPage } from '../project-ops'
import { useProject } from '../use-project'

export const Route = createFileRoute('/p/$projectId_/pages/$pageId')({
  loader: async ({ context, params }) => {
    const store = await context.library.open(params.projectId)
    if (!store || !findPage(store.get(), params.pageId)) throw notFound()
    return { store }
  },
  component: Editor,
  notFoundComponent: PageNotFound,
})

function Editor() {
  const { projectId, pageId } = Route.useParams()
  const { store } = Route.useLoaderData()
  const project = useProject(store)
  const { canUndo, canRedo } = useStore(store.state)
  const found = findPage(project, pageId)
  // 開いている間に Undo や別タブの操作でページが消えることがある
  if (!found) return <PageNotFound />
  const { page, pageIndex } = found
  return (
    <section className="editor">
      <header className="toolbar">
        <Link to="/p/$projectId" params={{ projectId }}>
          ← {project.title || '無題'}
        </Link>
        <span>{pageIndex + 1} ページ</span>
        <span className="toolbar-actions">
          <button type="button" disabled={!canUndo} onClick={() => store.undo()}>
            Undo
          </button>
          <button type="button" disabled={!canRedo} onClick={() => store.redo()}>
            Redo
          </button>
          <button type="button" disabled>
            書き出し
          </button>
        </span>
      </header>
      <div className="editor-body">
        <div className="canvas-placeholder">
          <p>キャンバス（EditorCanvas）</p>
          <p>
            コマ {page.panels.length} / フキダシ{' '}
            {page.panels.reduce((n, panel) => n + panel.bubbles.length, 0)}
          </p>
        </div>
        <aside className="inspector-placeholder">
          <h2>インスペクタ</h2>
          <pre>{JSON.stringify(page, null, 2)}</pre>
        </aside>
      </div>
    </section>
  )
}

function PageNotFound() {
  const { projectId, pageId } = useParams({ strict: false })
  return (
    <section>
      <h1>ページが見つかりません</h1>
      <p>
        {projectId} / {pageId}
      </p>
      {projectId ? (
        <Link to="/p/$projectId" params={{ projectId }}>
          ページ一覧へ
        </Link>
      ) : (
        <Link to="/">プロジェクト一覧へ</Link>
      )}
    </section>
  )
}
