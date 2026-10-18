import { m } from '@manga/i18n'
import type { Character } from '@manga/schema'
import { Button, ConfirmDialog, RemoveButton, Typography, XStack, YStack } from '@manga/ui'
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
        <Typography variant="heading">{m.web_characters_title()}</Typography>
        <Button
          size="small"
          variant="primary"
          data-guide="add-character"
          onClick={() =>
            void navigate({ to: '/p/$projectId/characters/new', params: { projectId } })
          }
        >
          {m.web_characters_add()}
        </Button>
      </XStack>
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
      {project.characters.length === 0 && (
        <Typography tone="muted">{m.web_characters_empty()}</Typography>
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
              {m.web_characters_usage({ count: characterUsage(project, character.id) })}
            </Typography>
            <XStack as="span" wrap gap={6} className={common.cardActions}>
              <RemoveButton
                size="small"
                label={m.web_common_delete()}
                onClick={() => setRemoving(character)}
              />
            </XStack>
          </YStack>
        ))}
      </ul>
      {removing && (
        <ConfirmDialog
          title={m.web_characters_remove()}
          message={m.web_characters_remove_confirm({ name: removing.name })}
          confirmLabel={m.web_common_delete()}
          onConfirm={() => {
            apply(m.web_characters_remove(), (p) => removeCharacterPatch(p, removing.id))
            setRemoving(undefined)
          }}
          onCancel={() => setRemoving(undefined)}
        />
      )}
    </YStack>
  )
}
