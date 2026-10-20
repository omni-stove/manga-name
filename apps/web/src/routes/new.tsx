import { m } from '@manga/i18n'
import { Button, FileDrop, Input, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { BackLink } from '../back-link'
import { tour } from '../onboarding/tour'
import { parseProjectFile } from '../project-file'
import { errorMessage } from '../route-error'
import styles from './projects.module.css'

export const Route = createFileRoute('/new')({ component: NewProject })

/** 題を付けて空のプロジェクトを作るか、書き出した JSON を読み込む。どちらも済んだらそのプロジェクトを開く */
function NewProject() {
  const { library } = Route.useRouteContext()
  const navigate = useNavigate()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  /** 失敗は画面に出す。同じプロジェクトを二重に作らないよう、実行中はボタンを止める */
  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await task()
    } catch (e) {
      setError(errorMessage(e))
    }
    setBusy(false)
  }

  const importFile = (file: File) =>
    run(async () => {
      const project = await library.import(parseProjectFile(await file.text()))
      await navigate({ to: '/p/$projectId', params: { projectId: project.id } })
    })

  return (
    <YStack as="section" gap={16}>
      <YStack as="header" gap={4} align="start">
        <BackLink to="/">{m.web_project_list()}</BackLink>
        <Typography variant="title">{m.web_new_project_title()}</Typography>
      </YStack>
      <form
        className={styles.create}
        data-guide="new-project"
        onSubmit={(e) => {
          e.preventDefault()
          const title = String(new FormData(e.currentTarget).get('title') ?? '').trim()
          void run(async () => {
            const project = await library.create(title || m.untitled())
            tour.created(project.id)
            await navigate({ to: '/p/$projectId', params: { projectId: project.id } })
          })
        }}
      >
        <XStack align="stretch">
          <Input name="title" placeholder={m.project_title()} label={m.project_title()} hideLabel />
          <Button type="submit" variant="primary" disabled={busy}>
            {m.web_new_project_create()}
          </Button>
        </XStack>
      </form>
      <FileDrop
        label={m.web_new_project_import()}
        accept="application/json,.json"
        prompt={m.web_new_project_import_prompt()}
        disabled={busy}
        onPick={(file) => void importFile(file)}
      />
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
    </YStack>
  )
}
