import { Button, Input, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type DragEvent, useState } from 'react'
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
  const [dragging, setDragging] = useState(false)

  /** 失敗は画面に出す。同じプロジェクトを二重に作らないよう、実行中はボタンを止める */
  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await task()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const importFile = (file: File) =>
    run(async () => {
      const project = await library.import(parseProjectFile(await file.text()))
      await navigate({ to: '/p/$projectId', params: { projectId: project.id } })
    })

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void importFile(file)
  }

  return (
    <YStack as="section" gap={16}>
      <Typography variant="title">新規プロジェクト</Typography>
      <form
        className={styles.create}
        onSubmit={(e) => {
          e.preventDefault()
          const title = String(new FormData(e.currentTarget).get('title') ?? '').trim()
          void run(async () => {
            const project = await library.create(title || '無題')
            await navigate({ to: '/p/$projectId', params: { projectId: project.id } })
          })
        }}
      >
        <XStack align="stretch">
          <Input name="title" placeholder="タイトル" label="タイトル" hideLabel />
          <Button type="submit" variant="primary" disabled={busy}>
            作成
          </Button>
        </XStack>
      </form>
      <fieldset
        className={styles.dropZone}
        data-dragging={dragging}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <label>
          JSON をここにドロップするか、ファイルを選んで読み込む{' '}
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(e) => {
              const input = e.currentTarget
              const file = input.files?.[0]
              // 同じファイルを選び直しても change が起きるよう空にする
              input.value = ''
              if (file) void importFile(file)
            }}
          />
        </label>
      </fieldset>
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
    </YStack>
  )
}
