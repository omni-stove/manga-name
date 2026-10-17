import type { ImageProvider } from '@manga/ai'
import { CharacterInspector } from '@manga/inspector'
import type { Character, ID, Patch, Project, ProjectSettings } from '@manga/schema'
import { Typography } from '@manga/ui'
import { useState } from 'react'
import { REFERENCE_ACCEPT, useFilePicker } from './file-picker'
import { characterPatch } from './inspector-ops'
import type { ProjectLibrary } from './project-library'
import { toCharacterImage } from './reference-image'
import { errorMessage } from './route-error'

/**
 * CharacterInspector に、参照画像を選ぶファイルダイアログ、外見からの生成、putAsset を付ける。
 * 選んだ画像も生成した画像も toCharacterImage で縮めた JPEG にして保存する
 */
export function CharacterPane({
  character,
  settings,
  projectId,
  library,
  imageProvider,
  apply,
  resolveAsset,
}: {
  character: Character
  settings: ProjectSettings
  projectId: ID
  library: Pick<ProjectLibrary, 'putAsset'>
  imageProvider: Pick<ImageProvider, 'generateCharacterArt'>
  apply(label: string, build: (project: Project) => Patch): boolean
  resolveAsset(ref: string): Promise<string>
}) {
  const [error, setError] = useState<string>()
  const [generating, setGenerating] = useState(false)

  const save = (label: string, image: Promise<Blob>) =>
    image
      .then(toCharacterImage)
      .then((blob) => library.putAsset(projectId, blob, `reference-${character.id}`))
      .then(
        (ref) => {
          setError(undefined)
          apply(label, (p) =>
            characterPatch(p, character.id, [{ op: 'add', path: '/referenceRef', value: ref }]),
          )
        },
        (err) => setError(errorMessage(err)),
      )

  const picker = useFilePicker(REFERENCE_ACCEPT, (file) => {
    void save('参照画像を差し替え', Promise.resolve(file))
  })

  const generate = () => {
    setGenerating(true)
    const image = imageProvider.generateCharacterArt({ project: { settings }, character }).then(
      (res) => res.image,
      (err) => {
        throw new Error(`参照画像を生成できませんでした: ${errorMessage(err)}`)
      },
    )
    void save('参照画像を生成', image).finally(() => setGenerating(false))
  }

  return (
    <>
      <CharacterInspector
        character={character}
        onChange={(patch) =>
          apply('キャラクターを編集', (p) => characterPatch(p, character.id, patch))
        }
        onPickReference={picker.open}
        onGenerateReference={generate}
        generating={generating}
        resolveAsset={resolveAsset}
      />
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
      {picker.input}
    </>
  )
}
