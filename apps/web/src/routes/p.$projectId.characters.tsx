import { Button, Field, Input, XStack, YStack } from '@manga/ui'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { CharacterPane } from '../character-pane'
import common from '../common.module.css'
import {
  addCharacterPatch,
  type CharacterFields,
  characterUsage,
  removeCharacterPatch,
} from '../project-ops'
import { useAssetResolver } from '../use-asset-resolver'
import { useApplyPatch, useProject } from '../use-project'
import styles from './characters.module.css'

export const Route = createFileRoute('/p/$projectId/characters')({ component: CharacterList })

const projectRoute = getRouteApi('/p/$projectId')

function CharacterList() {
  const { projectId } = Route.useParams()
  const { store } = projectRoute.useLoaderData()
  const { library } = Route.useRouteContext()
  const project = useProject(store)
  const { apply, error } = useApplyPatch(store)
  const resolveAsset = useAssetResolver(library.resolveAsset)
  return (
    <>
      <h2>キャラクター一覧</h2>
      {error && (
        <p className={common.error} role="alert">
          {error}
        </p>
      )}
      {project.characters.length === 0 && (
        <p className={common.placeholder}>まだキャラクターがいません。</p>
      )}
      <ul className={`${common.cards} ${styles.cards}`}>
        {project.characters.map((character) => (
          <YStack as="li" gap={6} key={character.id} className={common.card}>
            <CharacterPane
              character={character}
              projectId={projectId}
              library={library}
              apply={apply}
              resolveAsset={resolveAsset}
            />
            <small className={styles.usage}>使用コマ {characterUsage(project, character.id)}</small>
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
      <h3 className={styles.addTitle}>キャラクターを追加</h3>
      <div className={styles.add}>
        <AddCharacterForm
          onSubmit={(fields) => apply('キャラクターを追加', () => addCharacterPatch(fields).patch)}
        />
      </div>
    </>
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
  /** 反映できたら true */
  onSubmit(fields: CharacterFields): boolean
}) {
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const data = new FormData(form)
        const text = (key: string) => String(data.get(key) ?? '')
        const ok = onSubmit({
          name: text('name'),
          shortName: text('shortName'),
          appearance: text('appearance'),
          note: text('note'),
        })
        if (ok) form.reset()
      }}
    >
      {FIELDS.map((field) => (
        <Field key={field.name} label={field.label}>
          <Input name={field.name} required={field.required} />
        </Field>
      ))}
      <Button type="submit" size="small" variant="primary">
        追加
      </Button>
    </form>
  )
}
