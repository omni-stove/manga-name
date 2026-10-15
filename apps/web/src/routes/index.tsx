import { createFileRoute, Link } from '@tanstack/react-router'
import { placeholderProjects } from '../placeholder'

export const Route = createFileRoute('/')({ component: ProjectList })

function ProjectList() {
  return (
    <section>
      <h1>プロジェクト一覧</h1>
      <p className="placeholder">作成、削除、インポートはここに入る。</p>
      <ul className="cards">
        {placeholderProjects.map((project) => (
          <li key={project.id}>
            <Link to="/p/$projectId" params={{ projectId: project.id }}>
              <strong>{project.title}</strong>
              <small>更新 {project.updatedAt}</small>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
