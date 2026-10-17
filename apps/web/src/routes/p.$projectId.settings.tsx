import type { ProjectSettings } from '@manga/schema'
import { Button, Input, Select, TextArea, XStack } from '@manga/ui'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { useId } from 'react'
import common from '../common.module.css'
import { settingsPatch } from '../project-ops'
import { SharingPanel } from '../sharing-panel'
import { useApplyPatch, useProject } from '../use-project'
import styles from './project-settings.module.css'

export const Route = createFileRoute('/p/$projectId/settings')({ component: ProjectSettingsPage })

const projectRoute = getRouteApi('/p/$projectId')

/** 空欄は 0 ではなく NaN にして、スキーマに不正な値として弾かせる */
const toNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text))

function ProjectSettingsPage() {
  const { projectId } = Route.useParams()
  const { library, sharing } = Route.useRouteContext()
  const { store } = projectRoute.useLoaderData()
  const role = library.role(projectId) ?? 'owner'
  const project = useProject(store)
  const { apply, error } = useApplyPatch(store)
  const id = useId()
  const { direction, pageSize, dpi, style } = project.settings
  const field = (name: string) => `${id}-${name}`

  return (
    <>
      <h2>プロジェクト設定</h2>
      <form
        // Undo や他の画面での変更の後に、入力欄を保存済みの値へ戻すため、内容が変わったら作り直す
        key={JSON.stringify([project.title, project.settings])}
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          const data = new FormData(e.currentTarget)
          const text = (key: string) => String(data.get(key) ?? '')
          const number = (key: string) => toNumber(text(key))
          const negative = text('negative')
          const next: Pick<ProjectSettings, 'direction' | 'pageSize' | 'dpi' | 'style'> = {
            direction: text('direction') === 'ltr' ? 'ltr' : 'rtl',
            pageSize: { w: number('w'), h: number('h'), unit: 'mm' },
            dpi: number('dpi'),
            style: negative ? { prompt: text('prompt'), negative } : { prompt: text('prompt') },
          }
          const title = text('title')
          apply('プロジェクト設定を変更', (p) => {
            const patch = settingsPatch(p.settings, next)
            if (title !== p.title) patch.unshift({ op: 'replace', path: '/title', value: title })
            return patch
          })
        }}
      >
        <label htmlFor={field('title')}>タイトル</label>
        <Input id={field('title')} name="title" defaultValue={project.title} />

        <label htmlFor={field('direction')}>読む方向</label>
        <Select id={field('direction')} name="direction" defaultValue={direction}>
          <option value="rtl">右から左（rtl）</option>
          <option value="ltr">左から右（ltr）</option>
        </Select>

        <label htmlFor={field('w')}>判型（mm）</label>
        <XStack as="span" className={styles.size}>
          <Input
            id={field('w')}
            name="w"
            type="number"
            min="1"
            step="any"
            required
            aria-label="幅"
            defaultValue={pageSize.w}
          />
          ×
          <Input
            name="h"
            type="number"
            min="1"
            step="any"
            required
            aria-label="高さ"
            defaultValue={pageSize.h}
          />
        </XStack>

        <label htmlFor={field('dpi')}>dpi</label>
        <Input
          id={field('dpi')}
          name="dpi"
          type="number"
          min="1"
          step="1"
          required
          defaultValue={dpi}
        />

        <label htmlFor={field('prompt')}>スタイル</label>
        <TextArea id={field('prompt')} name="prompt" rows={3} defaultValue={style.prompt} />

        <label htmlFor={field('negative')}>除外するもの</label>
        <TextArea
          id={field('negative')}
          name="negative"
          rows={2}
          defaultValue={style.negative ?? ''}
        />

        <Button type="submit" variant="primary" disabled={role !== 'owner' && role !== 'editor'}>
          保存
        </Button>
      </form>
      {error && (
        <p className={common.error} role="alert">
          {error}
        </p>
      )}
      <h2>共有</h2>
      <SharingPanel projectId={projectId} sharing={sharing} />
    </>
  )
}
