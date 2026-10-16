import { Button, Input } from '@manga/ui'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { type DragEvent, useState } from 'react'
import common from '../common.module.css'
import { parseProjectFile } from '../project-file'
import { errorMessage } from '../route-error'
import styles from './projects.module.css'

export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    // debounce 待ちの変更を storage に反映してから読まないと、一覧に古いタイトルと並び順が出る
    await context.library.flushAll()
    return context.library.list()
  },
  component: ProjectList,
})

function ProjectList() {
  const projects = Route.useLoaderData()
  const { library } = Route.useRouteContext()
  const router = useRouter()
  const navigate = useNavigate()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  /** 失敗は画面に出す。並行して走らせないよう、実行中はボタンを止める */
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
    <section>
      <h1>プロジェクト一覧</h1>
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
        <Input name="title" placeholder="タイトル" aria-label="タイトル" />
        <Button type="submit" variant="primary" disabled={busy}>
          新規作成
        </Button>
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
        <p className={common.error} role="alert">
          {error}
        </p>
      )}
      {projects.length === 0 && (
        <p className={common.placeholder}>まだプロジェクトがありません。</p>
      )}
      <ul className={common.cards}>
        {projects.map((project) => (
          <li key={project.id} className={common.card}>
            <Link to="/p/$projectId" params={{ projectId: project.id }} className={common.cardLink}>
              <strong>{project.title || '無題'}</strong>
              <small className={styles.updated}>
                更新 {new Date(project.updatedAt).toLocaleString()}
              </small>
            </Link>
            <span className={common.cardActions}>
              <Button
                size="small"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`「${project.title}」を削除しますか？元に戻せません。`)) {
                    return
                  }
                  void run(async () => {
                    await library.remove(project.id)
                    await router.invalidate()
                  })
                }}
              >
                削除
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
