import { createFileRoute, Link } from '@tanstack/react-router'
import { artStatus, findProject } from '../placeholder'

export const Route = createFileRoute('/p/$projectId/')({ component: PageList })

function PageList() {
  const { projectId } = Route.useParams()
  const project = findProject(projectId)
  if (!project) return null
  return (
    <>
      <h2>ページ一覧</h2>
      <p className="placeholder">ページ追加（テンプレート選択）、削除、並べ替えはここに入る。</p>
      {project.episodes.map((episode) => (
        <article key={episode.id}>
          <h3>{episode.title}</h3>
          <ol className="cards">
            {episode.pages.map((page, index) => (
              <li key={page.id}>
                <Link to="/p/$projectId/pages/$pageId" params={{ projectId, pageId: page.id }}>
                  <strong>
                    {index + 1}. {page.id}
                  </strong>
                  <small>
                    {page.side} / コマ {page.panels.length} / 生成 {artStatus(page)}
                  </small>
                </Link>
              </li>
            ))}
          </ol>
        </article>
      ))}
    </>
  )
}
