import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { findProject } from '../placeholder'

export const Route = createFileRoute('/p/$projectId')({ component: ProjectLayout })

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const project = findProject(projectId)
  if (!project) {
    return (
      <section>
        <h1>プロジェクトが見つかりません</h1>
        <p>{projectId}</p>
        <Link to="/">プロジェクト一覧へ</Link>
      </section>
    )
  }
  return (
    <section>
      <header className="project-header">
        <h1>{project.title}</h1>
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
      </header>
      <Outlet />
    </section>
  )
}
