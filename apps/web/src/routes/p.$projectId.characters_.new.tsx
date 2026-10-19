import { m } from '@manga/i18n'
import { Button, FileDrop, Input, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { BackLink } from '../back-link'
import { REFERENCE_ACCEPT } from '../file-picker'
import { addCharacterPatch, type CharacterFields } from '../project-ops'
import { toCharacterImage } from '../reference-image'
import { FailureAlert } from '../sign-in'
import { useApplyPatch, useProject } from '../use-project'
import styles from './characters.module.css'

export const Route = createFileRoute('/p/$projectId/characters_/new')({ component: NewCharacter })

const projectRoute = getRouteApi('/p/$projectId')

const FIELDS = [
  { name: 'name', label: () => m.character_name(), required: true },
  { name: 'shortName', label: () => m.character_short_name(), required: true },
  { name: 'appearance', label: () => m.web_character_field_appearance(), required: false },
  { name: 'note', label: () => m.character_note(), required: false },
] as const

/**
 * キャラクターを追加するページ。参照画像を選べばそれを、選ばなければ名前と外見から
 * `imageProvider.generateCharacterArt` で作った画像を、toCharacterImage で縮めて参照画像にする。
 * 足せたらキャラクター一覧に戻り、失敗したら入力を残したまま理由を出す
 */
function NewCharacter() {
  const { projectId } = Route.useParams()
  const { store } = projectRoute.useLoaderData()
  const { library, imageProvider } = Route.useRouteContext()
  const project = useProject(store)
  const { apply, error } = useApplyPatch(store)
  const navigate = useNavigate()
  const [busy, setBusy] = useState<'adding' | 'generating'>()
  const [failure, setFailure] = useState<{ failure: string; error: unknown }>()

  // 生成中にキャンセルや別ページへの移動で離れたら、終わっても追加も遷移もしない
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const backToList = () => navigate({ to: '/p/$projectId/characters', params: { projectId } })

  const add = async (fields: CharacterFields, image: File | undefined) => {
    setFailure(undefined)
    setBusy(image ? 'adding' : 'generating')
    let stage = m.web_character_add_failed()
    try {
      const { character } = addCharacterPatch(fields)
      let source: Blob
      if (image) {
        stage = m.web_character_reference_read_failed()
        source = image
      } else {
        stage = m.web_character_reference_generate_failed()
        source = (
          await imageProvider.generateCharacterArt({
            project: { settings: project.settings },
            character,
          })
        ).image
      }
      const referenceRef = await library.putAsset(
        projectId,
        await toCharacterImage(source),
        'reference',
      )
      if (!mounted.current) return
      if (
        apply(m.web_characters_add(), () => addCharacterPatch({ ...fields, referenceRef }).patch)
      ) {
        await backToList()
      }
    } catch (err) {
      setFailure({ failure: stage, error: err })
    }
    setBusy(undefined)
  }

  return (
    <YStack gap={12}>
      <YStack as="header" gap={4} align="start">
        <BackLink to="/p/$projectId/characters" params={{ projectId }}>
          {m.web_characters_title()}
        </BackLink>
        <Typography as="h1" variant="heading">
          {m.web_characters_add()}
        </Typography>
      </YStack>
      <form
        className={styles.add}
        data-guide="character-form"
        onSubmit={(e) => {
          e.preventDefault()
          const data = new FormData(e.currentTarget)
          const text = (key: string) => String(data.get(key) ?? '')
          const image = data.get('reference')
          void add(
            {
              name: text('name'),
              shortName: text('shortName'),
              appearance: text('appearance'),
              note: text('note'),
            },
            // 何も選ばないと空の File が入る
            image instanceof File && image.size > 0 ? image : undefined,
          )
        }}
      >
        <YStack as="fieldset" gap={8} className={styles.fieldset} disabled={busy !== undefined}>
          {FIELDS.map((field) => (
            <Input
              key={field.name}
              label={field.label()}
              name={field.name}
              required={field.required}
            />
          ))}
          <FileDrop
            label={m.character_reference()}
            name="reference"
            accept={REFERENCE_ACCEPT}
            hint={m.web_character_reference_hint()}
          />
        </YStack>
        {failure && <FailureAlert {...failure} signInButton={false} />}
        {error && (
          <Typography tone="alert" role="alert">
            {error}
          </Typography>
        )}
        <XStack wrap gap={8}>
          <Button type="submit" size="small" variant="primary" disabled={busy !== undefined}>
            {busy === 'generating'
              ? m.generating()
              : busy === 'adding'
                ? m.web_character_adding()
                : m.add()}
          </Button>
          <Button size="small" onClick={() => void backToList()}>
            {m.cancel()}
          </Button>
        </XStack>
      </form>
    </YStack>
  )
}
