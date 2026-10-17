import { CharacterInspector } from '@manga/inspector'
import type { Character, ID, Patch, Project } from '@manga/schema'
import { useState } from 'react'
import common from './common.module.css'
import { REFERENCE_ACCEPT, useFilePicker } from './file-picker'
import { characterPatch } from './inspector-ops'
import type { ProjectLibrary } from './project-library'
import { toReferenceImage } from './reference-image'
import { errorMessage } from './route-error'

/** CharacterInspector に、参照画像を選ぶファイルダイアログと putAsset を付ける。読み込みはページの参考画像と同じ経路 */
export function CharacterPane({
  character,
  projectId,
  library,
  apply,
  resolveAsset,
}: {
  character: Character
  projectId: ID
  library: Pick<ProjectLibrary, 'putAsset'>
  apply(label: string, build: (project: Project) => Patch): boolean
  resolveAsset(ref: string): Promise<string>
}) {
  const [pickError, setPickError] = useState<string>()
  const picker = useFilePicker(REFERENCE_ACCEPT, (file) => {
    toReferenceImage(file)
      .then((blob) => library.putAsset(projectId, blob, `reference-${character.id}`))
      .then(
        (ref) => {
          setPickError(undefined)
          apply('参照画像を差し替え', (p) =>
            characterPatch(p, character.id, [{ op: 'add', path: '/referenceRef', value: ref }]),
          )
        },
        (err) => setPickError(errorMessage(err)),
      )
  })
  return (
    <>
      <CharacterInspector
        character={character}
        onChange={(patch) =>
          apply('キャラクターを編集', (p) => characterPatch(p, character.id, patch))
        }
        onPickReference={picker.open}
        resolveAsset={resolveAsset}
      />
      {pickError && (
        <p className={common.error} role="alert">
          {pickError}
        </p>
      )}
      {picker.input}
    </>
  )
}
