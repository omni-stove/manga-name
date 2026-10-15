import { createFileRoute, Link } from '@tanstack/react-router'
import { findPage, findProject } from '../placeholder'

export const Route = createFileRoute('/p/$projectId_/pages/$pageId')({ component: Editor })

function Editor() {
  const { projectId, pageId } = Route.useParams()
  const project = findProject(projectId)
  const page = project ? findPage(project, pageId) : undefined
  if (!project || !page) {
    return (
      <section>
        <h1>ページが見つかりません</h1>
        <p>
          {projectId} / {pageId}
        </p>
        <Link to="/">プロジェクト一覧へ</Link>
      </section>
    )
  }
  return (
    <section className="editor">
      <header className="toolbar">
        <Link to="/p/$projectId" params={{ projectId }}>
          ← {project.title}
        </Link>
        <span>{page.id}</span>
        <span className="toolbar-actions">
          <button type="button" disabled>
            Undo
          </button>
          <button type="button" disabled>
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
