import type { ProjectSettings } from '@manga/schema'
import { Button, FieldGroup, Input, Select, TextArea, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
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
  const { direction, pageSize, dpi, style } = project.settings

  return (
    <YStack gap={16}>
      <Typography variant="heading">プロジェクト設定</Typography>
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
        <Input label="タイトル" name="title" defaultValue={project.title} />
        <Select label="読む方向" name="direction" defaultValue={direction}>
          <option value="rtl">右から左（rtl）</option>
          <option value="ltr">左から右（ltr）</option>
        </Select>
        <FieldGroup label="判型（mm）">
          <XStack className={styles.size}>
            <Input
              label="幅"
              hideLabel
              name="w"
              type="number"
              min="1"
              step="any"
              required
              defaultValue={pageSize.w}
            />
            ×
            <Input
              label="高さ"
              hideLabel
              name="h"
              type="number"
              min="1"
              step="any"
              required
              defaultValue={pageSize.h}
            />
          </XStack>
        </FieldGroup>
        <Input label="dpi" name="dpi" type="number" min="1" step="1" required defaultValue={dpi} />
        <TextArea label="スタイル" name="prompt" rows={3} defaultValue={style.prompt} />
        <TextArea
          label="除外するもの"
          name="negative"
          rows={2}
          defaultValue={style.negative ?? ''}
        />
        <Button type="submit" variant="primary" disabled={role !== 'owner' && role !== 'editor'}>
          保存
        </Button>
      </form>
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
      <Typography variant="heading">共有</Typography>
      <SharingPanel projectId={projectId} sharing={sharing} />
    </YStack>
  )
}
