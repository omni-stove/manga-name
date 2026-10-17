import type { ProjectSummary } from '@manga/storage'
import { Button, ConfirmDialog, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import common from '../common.module.css'
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
  const [removing, setRemoving] = useState<ProjectSummary>()

  /** 失敗は画面に出す。削除を並行して走らせないよう、実行中はボタンを止める */
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

  return (
    <YStack as="section" gap={16}>
      <XStack wrap gap={12}>
        <Typography variant="title">プロジェクト一覧</Typography>
        <Button variant="primary" onClick={() => void navigate({ to: '/new' })}>
          新規作成
        </Button>
      </XStack>
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
      {projects.length === 0 && (
        <Typography tone="muted">まだプロジェクトがありません。</Typography>
      )}
      <ul className={common.cards}>
        {projects.map((project) => (
          <YStack as="li" gap={6} key={project.id} className={common.card}>
            <Link to="/p/$projectId" params={{ projectId: project.id }} className={common.cardLink}>
              <YStack gap={4}>
                <strong>{project.title || '無題'}</strong>
                <Typography as="small" variant="caption" tone="muted">
                  更新 {new Date(project.updatedAt).toLocaleString()}
                </Typography>
              </YStack>
            </Link>
            <XStack as="span" wrap gap={6} className={common.cardActions}>
              <Button
                size="small"
                variant="ghost"
                disabled={busy}
                onClick={() => setRemoving(project)}
              >
                削除
              </Button>
            </XStack>
          </YStack>
        ))}
      </ul>
      {removing && (
        <ConfirmDialog
          title="プロジェクトを削除"
          message={`「${removing.title || '無題'}」を削除しますか？元に戻せません。`}
          confirmLabel="削除"
          irreversible
          onConfirm={() => {
            setRemoving(undefined)
            void run(async () => {
              await library.remove(removing.id)
              await router.invalidate()
            })
          }}
          onCancel={() => setRemoving(undefined)}
        />
      )}
    </YStack>
  )
}
