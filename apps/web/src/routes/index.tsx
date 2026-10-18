import { getLocale, m } from '@manga/i18n'
import type { ProjectSummary } from '@manga/storage'
import { Button, ConfirmDialog, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Suspense, use, useState } from 'react'
import common from '../common.module.css'
import { errorMessage } from '../route-error'

interface CardProps {
  busy: boolean
  onRemove(project: ProjectSummary): void
}

export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    // debounce 待ちの変更を storage に反映してから読まないと、一覧に古いタイトルと並び順が出る
    await context.library.flushAll()
    // クラウドにしか無い分は待たずに渡し、手元の分だけで一覧を出す。API が遅くても手元のプロジェクトを開ける
    const { local, cloudOnly } = context.library.listByOrigin()
    return { local: await local, cloudOnly }
  },
  component: ProjectList,
})

function ProjectList() {
  const { local, cloudOnly } = Route.useLoaderData()
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
    }
    setBusy(false)
  }

  return (
    <YStack as="section" gap={16}>
      <XStack wrap gap={12}>
        <Typography variant="title">{m.web_project_list()}</Typography>
        <Button variant="primary" onClick={() => void navigate({ to: '/new' })}>
          {m.web_projects_create_new()}
        </Button>
      </XStack>
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
      <ul className={common.cards}>
        {local.map((project) => (
          <ProjectCard key={project.id} project={project} busy={busy} onRemove={setRemoving} />
        ))}
        <Suspense
          fallback={
            <Typography as="li" tone="muted">
              {m.web_projects_loading_cloud()}
            </Typography>
          }
        >
          <CloudOnlyCards projects={cloudOnly} busy={busy} onRemove={setRemoving} />
        </Suspense>
      </ul>
      {local.length === 0 && (
        <Suspense>
          <NoProjects cloudOnly={cloudOnly} />
        </Suspense>
      )}
      {removing && (
        <ConfirmDialog
          title={m.web_projects_remove_title()}
          message={m.web_projects_remove_message({
            title: removing.title || m.web_common_untitled(),
          })}
          confirmLabel={m.web_common_delete()}
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

function ProjectCard({ project, busy, onRemove }: CardProps & { project: ProjectSummary }) {
  return (
    <YStack as="li" gap={6} className={common.card}>
      <Link to="/p/$projectId" params={{ projectId: project.id }} className={common.cardLink}>
        <YStack gap={4}>
          <strong>{project.title || m.web_common_untitled()}</strong>
          <Typography as="small" variant="caption" tone="muted">
            {m.web_projects_updated_at({
              date: new Date(project.updatedAt).toLocaleString(getLocale()),
            })}
          </Typography>
        </YStack>
      </Link>
      <XStack as="span" wrap gap={6} className={common.cardActions}>
        <Button size="small" variant="ghost" disabled={busy} onClick={() => onRemove(project)}>
          {m.web_common_delete()}
        </Button>
      </XStack>
    </YStack>
  )
}

/** クラウドにしか無いプロジェクト。届いた時点で手元の分の後ろに足す。並べ直すと開こうとしたカードが動くため */
function CloudOnlyCards({
  projects,
  ...card
}: CardProps & { projects: Promise<ProjectSummary[]> }) {
  return use(projects).map((project) => (
    <ProjectCard key={project.id} project={project} {...card} />
  ))
}

function NoProjects({ cloudOnly }: { cloudOnly: Promise<ProjectSummary[]> }) {
  if (use(cloudOnly).length > 0) return null
  return <Typography tone="muted">{m.web_projects_empty()}</Typography>
}
