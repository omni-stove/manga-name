import type { Character } from '@manga/schema'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { Fragment, useId } from 'react'
import {
  addCharacterPatch,
  type CharacterFields,
  characterUsage,
  removeCharacterPatch,
  updateCharacterPatch,
} from '../project-ops'
import { useApplyPatch, useProject } from '../use-project'

export const Route = createFileRoute('/p/$projectId/characters')({ component: CharacterList })

const projectRoute = getRouteApi('/p/$projectId')

function CharacterList() {
  const { store } = projectRoute.useLoaderData()
  const project = useProject(store)
  const { apply, error } = useApplyPatch(store)
  return (
    <>
      <h2>キャラクター一覧</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {project.characters.length === 0 && <p>まだキャラクターがいません。</p>}
      <ul className="cards">
        {project.characters.map((character) => (
          <li key={character.id}>
            <CharacterForm
              // 保存後に入力欄を保存済みの値へ戻すため、内容が変わったら作り直す
              key={JSON.stringify(character)}
              initial={character}
              submitLabel="保存"
              onSubmit={(fields) =>
                apply('キャラクターを編集', (p) => updateCharacterPatch(p, character.id, fields))
              }
            />
            <small>使用コマ {characterUsage(project, character.id)}</small>
            <span className="card-actions">
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`${character.name} を削除しますか？`)) return
                  apply('キャラクターを削除', (p) => removeCharacterPatch(p, character.id))
                }}
              >
                削除
              </button>
            </span>
          </li>
        ))}
      </ul>
      <h3>キャラクターを追加</h3>
      <CharacterForm
        submitLabel="追加"
        resetOnSuccess
        onSubmit={(fields) => apply('キャラクターを追加', () => addCharacterPatch(fields).patch)}
      />
    </>
  )
}

const FIELDS = [
  { name: 'name', label: '名前', required: true },
  { name: 'shortName', label: '略称', required: true },
  { name: 'appearance', label: '外見（生成プロンプトに入る）', required: false },
  { name: 'note', label: 'メモ', required: false },
] as const

function CharacterForm({
  initial,
  submitLabel,
  resetOnSuccess = false,
  onSubmit,
}: {
  initial?: Character
  submitLabel: string
  resetOnSuccess?: boolean
  /** 反映できたら true */
  onSubmit(fields: CharacterFields): boolean
}) {
  const id = useId()
  return (
    <form
      className="fields"
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
        if (ok && resetOnSuccess) form.reset()
      }}
    >
      {FIELDS.map((field) => (
        <Fragment key={field.name}>
          <label htmlFor={`${id}-${field.name}`}>{field.label}</label>
          <input
            id={`${id}-${field.name}`}
            name={field.name}
            required={field.required}
            defaultValue={initial?.[field.name] ?? ''}
          />
        </Fragment>
      ))}
      <span />
      <button type="submit">{submitLabel}</button>
    </form>
  )
}
