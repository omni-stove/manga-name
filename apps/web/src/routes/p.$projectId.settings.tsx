import { createFileRoute } from '@tanstack/react-router'
import { findProject } from '../placeholder'

export const Route = createFileRoute('/p/$projectId/settings')({ component: ProjectSettings })

function ProjectSettings() {
  const { projectId } = Route.useParams()
  const project = findProject(projectId)
  if (!project) return null
  const { direction, pageSize, dpi, style } = project.settings
  return (
    <>
      <h2>プロジェクト設定</h2>
      <p className="placeholder">編集フォームはここに入る。</p>
      <dl className="fields">
        <dt>direction</dt>
        <dd>{direction}</dd>
        <dt>pageSize</dt>
        <dd>
          {pageSize.w} x {pageSize.h} {pageSize.unit}
        </dd>
        <dt>dpi</dt>
        <dd>{dpi}</dd>
        <dt>style.prompt</dt>
        <dd>{style.prompt}</dd>
        <dt>style.negative</dt>
        <dd>{style.negative}</dd>
      </dl>
    </>
  )
}
