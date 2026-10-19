import { m } from '@manga/i18n'
import { useDraft } from '@manga/inspector'
import type { Character } from '@manga/schema'
import {
  Button,
  ConfirmDialog,
  RemoveButton,
  TextArea,
  Typography,
  XStack,
  YStack,
} from '@manga/ui'
import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { CharacterPane } from '../character-pane'
import common from '../common.module.css'
import { characterDesignPatch, characterUsage, removeCharacterPatch } from '../project-ops'
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
  // 編集中に他の端末や取り消しで値が変わっても、入力途中の下書きを上書きしない
  const design = useDraft(
    project.settings.characterDesign ?? '',
    (next) => {
      // 閲覧のみの store は空の Patch でも断るので、変わらないときは apply しない
      if (characterDesignPatch(store.get().settings, next).length === 0) return
      apply(m.web_characters_design_history(), (p) => characterDesignPatch(p.settings, next))
    },
    null,
  )
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
      <TextArea
        className={styles.design}
        label={m.web_characters_design()}
        hint={m.web_characters_design_hint()}
        placeholder={m.web_characters_design_placeholder()}
        rows={3}
        value={design.draft}
        onChange={(e) => design.set(e.target.value)}
        onBlur={design.flush}
      />
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
