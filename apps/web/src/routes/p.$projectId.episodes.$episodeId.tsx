import { type Episode, type PageTemplate, pageCharacterIds } from '@manga/schema'
import { Button, Select, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { BatchOptions, useBatchGeneration } from '../batch-generation'
import { PeerBadge, usePeers } from '../collaboration-view'
import collabStyles from '../collaboration-view.module.css'
import common from '../common.module.css'
import { PageThumbnail } from '../page-thumbnail'
import {
  addPagePatch,
  artStatus,
  movePagePatch,
  PAGE_TEMPLATES,
  removePagePatch,
} from '../project-ops'
import { ScriptDraftDialog } from '../script-draft-dialog'
import type { ProjectStore } from '../store/project-store'
import { useApplyPatch, useProject } from '../use-project'
import { useUndoShortcuts } from '../use-undo-shortcuts'
import styles from './pages.module.css'

export const Route = createFileRoute('/p/$projectId/episodes/$episodeId')({
  component: EpisodePages,
})

const projectRoute = getRouteApi('/p/$projectId')

/** 1 話分の見出し、ページの追加と下書きと一括生成、ページのカードを並べる */
function EpisodePages() {
  const { projectId, episodeId } = Route.useParams()
  const { store, collab } = projectRoute.useLoaderData()
  const { library, llmProvider } = Route.useRouteContext()
  const project = useProject(store)
  const peers = usePeers(collab)
  const { apply, error } = useApplyPatch(store)
  useUndoShortcuts(store)
  const [template, setTemplate] = useState<PageTemplate>('3rows')
  const [drafting, setDrafting] = useState(false)
  const episode = project.episodes.find((e) => e.id === episodeId)
  // 開いている間に Undo や他の人の操作でエピソードが消えることがある
  if (!episode) return <EpisodeNotFound projectId={projectId} />
  const pages = episode.pages
  // rtl の本では先のページが左にあるので、並べ替えのボタンを向きに合わせる
  const [earlier, later] = project.settings.direction === 'rtl' ? ['→', '←'] : ['←', '→']

  return (
    <YStack gap={8}>
      <XStack wrap gap={12}>
        <Link to="/p/$projectId" params={{ projectId }}>
          エピソード一覧
        </Link>
        <Typography variant="heading">{episode.title}</Typography>
      </XStack>
      {error && (
        <Typography tone="alert" role="alert">
          {error}
        </Typography>
      )}
      <XStack
        as="form"
        wrap
        gap={12}
        className={common.toolbar}
        onSubmit={(e) => {
          e.preventDefault()
          apply('ページを追加', (p) => addPagePatch(p, template, episode.id).patch)
        }}
      >
        <Select
          label="テンプレート"
          inline
          value={template}
          onChange={(e) => setTemplate(e.currentTarget.value as PageTemplate)}
        >
          {PAGE_TEMPLATES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary">
          ページを追加
        </Button>
        <Button onClick={() => setDrafting(true)}>脚本から下書き</Button>
      </XStack>
      {drafting && (
        <ScriptDraftDialog
          project={project}
          store={store}
          llmProvider={llmProvider}
          episodeId={episode.id}
          template={template}
          onClose={() => setDrafting(false)}
        />
      )}
      <EpisodeBatch episode={episode} projectId={projectId} store={store} />
      {pages.length === 0 && <Typography tone="muted">ページがありません。</Typography>}
      <ol className={`${common.cards} ${styles.pages}`} data-direction={project.settings.direction}>
        {pages.map((page, index) => {
          const status = artStatus(page)
          const cast = pageCharacterIds(page).flatMap((id) =>
            project.characters.filter((c) => c.id === id).map((c) => c.name),
          )
          const editing = peers.filter((peer) => peer.pageId === page.id)
          return (
            <YStack as="li" gap={6} key={page.id} className={common.card}>
              <Link
                to="/p/$projectId/pages/$pageId"
                params={{ projectId, pageId: page.id }}
                className={common.cardLink}
              >
                <YStack gap={4}>
                  <PageThumbnail
                    page={page}
                    pageSize={project.settings.pageSize}
                    resolveAsset={library.resolveAsset}
                  />
                  <strong>{index + 1} ページ</strong>
                </YStack>
              </Link>
              {editing.length > 0 && (
                <XStack
                  as="fieldset"
                  wrap
                  gap={4}
                  align="stretch"
                  className={collabStyles.peers}
                  aria-label="編集中の人"
                >
                  {editing.map((peer) => (
                    <PeerBadge key={peer.clientId} name={peer.name} color={peer.color} />
                  ))}
                </XStack>
              )}
              <Typography as="small" variant="caption" tone="muted">
                コマ {page.panels.length} / 生成{' '}
                <span className={styles.status} data-status={status}>
                  {status}
                </span>
              </Typography>
              {page.note !== undefined && (
                <Typography as="small" variant="caption" className={styles.note}>
                  {page.note}
                </Typography>
              )}
              {cast.length > 0 && (
                <Typography as="small" variant="caption" tone="muted" data-page-cast>
                  登場: {cast.join('、')}
                </Typography>
              )}
              <XStack as="span" wrap gap={6} className={common.cardActions}>
                <Button
                  size="small"
                  variant="ghost"
                  aria-label="前へ"
                  disabled={index === 0}
                  onClick={() => apply('ページを移動', (p) => movePagePatch(p, page.id, -1))}
                >
                  {earlier}
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  aria-label="後ろへ"
                  disabled={index === pages.length - 1}
                  onClick={() => apply('ページを移動', (p) => movePagePatch(p, page.id, 1))}
                >
                  {later}
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => {
                    if (!window.confirm(`${index + 1} ページを削除しますか？`)) return
                    apply('ページを削除', (p) => removePagePatch(p, page.id))
                  }}
                >
                  削除
                </Button>
              </XStack>
            </YStack>
          )
        })}
      </ol>
    </YStack>
  )
}

function EpisodeNotFound({ projectId }: { projectId: string }) {
  return (
    <YStack as="section" gap={16} align="start">
      <Typography variant="title">エピソードが見つかりません</Typography>
      <Link to="/p/$projectId" params={{ projectId }}>
        エピソード一覧へ
      </Link>
    </YStack>
  )
}

/** エピソードのページを全部まとめて生成する */
function EpisodeBatch({
  episode,
  projectId,
  store,
}: {
  episode: Episode
  projectId: string
  store: ProjectStore
}) {
  const { generation } = Route.useRouteContext()
  const batch = useBatchGeneration({
    generation,
    store,
    projectId,
    scope: `episode/${episode.id}`,
    pageIds: episode.pages.map((page) => page.id),
  })
  return (
    <XStack wrap gap={12} className={common.toolbar}>
      <Button disabled={batch.running || episode.pages.length === 0} onClick={batch.start}>
        {batch.running ? '生成中…' : '全部生成'}
      </Button>
      <BatchOptions batch={batch} />
    </XStack>
  )
}
