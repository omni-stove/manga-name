import { Button, Input, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { useState } from 'react'
import { CharacterPane } from '../character-pane'
import common from '../common.module.css'
import { REFERENCE_ACCEPT } from '../file-picker'
import {
  addCharacterPatch,
  type CharacterFields,
  characterUsage,
  removeCharacterPatch,
} from '../project-ops'
import { toCharacterImage } from '../reference-image'
import { errorMessage } from '../route-error'
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
  return (
    <YStack gap={8}>
      <Typography variant="heading">キャラクター一覧</Typography>
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
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  if (!window.confirm(`${character.name} を削除しますか？`)) return
                  apply('キャラクターを削除', (p) => removeCharacterPatch(p, character.id))
                }}
              >
                削除
              </Button>
            </XStack>
          </YStack>
        ))}
      </ul>
      <YStack as="section" gap={8} className={styles.addSection}>
        <Typography variant="subheading">キャラクターを追加</Typography>
        <div className={styles.add}>
          <AddCharacterForm
            onSubmit={async (fields, image) => {
              const referenceRef =
                image &&
                (await library.putAsset(projectId, await toCharacterImage(image), 'reference'))
              return apply(
                'キャラクターを追加',
                () => addCharacterPatch({ ...fields, referenceRef }).patch,
              )
            }}
          />
        </div>
      </YStack>
    </YStack>
  )
}

const FIELDS = [
  { name: 'name', label: '名前', required: true },
  { name: 'shortName', label: '略称', required: true },
  { name: 'appearance', label: '外見（生成プロンプトに入る）', required: false },
  { name: 'note', label: 'メモ', required: false },
] as const

function AddCharacterForm({
  onSubmit,
}: {
  /** 反映できたら true。参照画像を読めなければ reject する */
  onSubmit(fields: CharacterFields, image: File | undefined): Promise<boolean>
}) {
  const [busy, setBusy] = useState(false)
  const [imageError, setImageError] = useState<string>()
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const data = new FormData(form)
        const text = (key: string) => String(data.get(key) ?? '')
        const image = data.get('reference')
        setBusy(true)
        onSubmit(
          {
            name: text('name'),
            shortName: text('shortName'),
            appearance: text('appearance'),
            note: text('note'),
          },
          // 何も選ばないと空の File が入る
          image instanceof File && image.size > 0 ? image : undefined,
        )
          .then(
            (ok) => {
              setImageError(undefined)
              if (ok) form.reset()
            },
            (err) => setImageError(errorMessage(err)),
          )
          .finally(() => setBusy(false))
      }}
    >
      {FIELDS.map((field) => (
        <Input key={field.name} label={field.label} name={field.name} required={field.required} />
      ))}
      <Input
        label="参照画像"
        name="reference"
        type="file"
        accept={REFERENCE_ACCEPT}
        error={imageError}
      />
      <Button type="submit" size="small" variant="primary" disabled={busy}>
        追加
      </Button>
    </form>
  )
}
