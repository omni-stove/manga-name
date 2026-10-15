import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { type DragEvent, useState } from 'react'
import { parseProjectFile } from '../project-file'
import { errorMessage } from '../route-error'

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
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          const title = String(new FormData(e.currentTarget).get('title') ?? '').trim()
          void run(async () => {
            const project = await library.create(title || '無題')
            await navigate({ to: '/p/$projectId', params: { projectId: project.id } })
          })
        }}
      >
        <input name="title" placeholder="タイトル" aria-label="タイトル" />
        <button type="submit" disabled={busy}>
          新規作成
        </button>
      </form>
      <div
        className="drop-zone"
        role="group"
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
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {projects.length === 0 && <p>まだプロジェクトがありません。</p>}
      <ul className="cards">
        {projects.map((project) => (
          <li key={project.id}>
            <Link to="/p/$projectId" params={{ projectId: project.id }}>
              <strong>{project.title || '無題'}</strong>
              <small>更新 {new Date(project.updatedAt).toLocaleString()}</small>
            </Link>
            <span className="card-actions">
              <button
                type="button"
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
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
