import type { Character } from '@manga/schema'
import { Button, ConfirmDialog, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { CharacterPane } from '../character-pane'
import common from '../common.module.css'
import { characterUsage, removeCharacterPatch } from '../project-ops'
import { useAssetResolver } from '../use-asset-resolver'
import { useApplyPatch, useProject } from '../use-project'
import styles from './characters.module.css'

export const Route = createFileRoute('/p/$projectId/characters')({ component: CharacterList })

const projectRoute = getRouteApi('/p/$projectId')

function CharacterList() {
  const { projectId } = Route.useParams()
  const { store } = projectRoute.useLoaderData()
  const { library, imageProvider } = Route.useRouteContext()
  const project = useProject(store)
  const { apply, error } = useApplyPatch(store)
  const resolveAsset = useAssetResolver(library.resolveAsset)
  const navigate = useNavigate()
  const [removing, setRemoving] = useState<Character>()
  return (
    <YStack gap={8}>
      <XStack wrap gap={12}>
        <Typography variant="heading">キャラクター一覧</Typography>
        <Button
          size="small"
          variant="primary"
          onClick={() =>
            void navigate({ to: '/p/$projectId/characters/new', params: { projectId } })
          }
        >
          キャラクターを追加
        </Button>
      </XStack>
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
      {project.characters.length === 0 && (
        <Typography tone="muted">まだキャラクターがいません。</Typography>
      )}
      <ul className={`${common.cards} ${styles.cards}`}>
        {project.characters.map((character) => (
          <YStack as="li" gap={6} key={character.id} className={common.card}>
            <CharacterPane
              character={character}
              settings={project.settings}
              projectId={projectId}
              library={library}
              imageProvider={imageProvider}
              apply={apply}
              resolveAsset={resolveAsset}
            />
            <Typography as="small" variant="caption" tone="muted">
              使用コマ {characterUsage(project, character.id)}
            </Typography>
            <XStack as="span" wrap gap={6} className={common.cardActions}>
              <Button size="small" variant="ghost" onClick={() => setRemoving(character)}>
                削除
              </Button>
            </XStack>
          </YStack>
        ))}
      </ul>
      {removing && (
        <ConfirmDialog
          title="キャラクターを削除"
          message={`${removing.name} を削除しますか？`}
          confirmLabel="削除"
          onConfirm={() => {
            apply('キャラクターを削除', (p) => removeCharacterPatch(p, removing.id))
            setRemoving(undefined)
          }}
          onCancel={() => setRemoving(undefined)}
        />
      )}
    </YStack>
  )
}
