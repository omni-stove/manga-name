import { createFileRoute } from '@tanstack/react-router'
import { findProject } from '../placeholder'

export const Route = createFileRoute('/p/$projectId/characters')({ component: CharacterList })

function CharacterList() {
  const { projectId } = Route.useParams()
  const project = findProject(projectId)
  if (!project) return null
  return (
    <>
      <h2>キャラクター一覧</h2>
      <p className="placeholder">追加と編集フォームはここに入る。</p>
      <ul className="cards">
        {project.characters.map((character) => (
          <li key={character.id}>
            <strong>
              {character.name}（{character.shortName}）
            </strong>
            <small>{character.appearance ?? '外見は未設定'}</small>
          </li>
        ))}
      </ul>
    </>
  )
}
