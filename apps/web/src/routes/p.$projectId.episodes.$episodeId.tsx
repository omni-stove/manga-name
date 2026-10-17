import { type Episode, type PageTemplate, pageCharacterIds } from '@manga/schema'
import { Button, ConfirmDialog, Input, Select, Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
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
  removeEpisodePatch,
  removePagePatch,
  renameEpisodePatch,
} from '../project-ops'
import { RemoveEpisodeDialog } from '../remove-episode-dialog'
import { ScriptDraftDialog } from '../script-draft-dialog'
import type { ProjectStore } from '../store/project-store'
import { useApplyPatch, useProject } from '../use-project'
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
  const [template, setTemplate] = useState<PageTemplate>('3rows')
  const [drafting, setDrafting] = useState(false)
  const [removingEpisode, setRemovingEpisode] = useState(false)
  /** 確認中のページの id と、確認の文言に出すページ番号 */
  const [removingPage, setRemovingPage] = useState<{ id: string; number: number }>()
  const navigate = useNavigate()
  const episode = project.episodes.find((e) => e.id === episodeId)
  // 開いている間に Undo や他の人の操作でエピソードが消えることがある
  if (!episode) return <EpisodeNotFound projectId={projectId} />
  const pages = episode.pages

  return (
    <YStack gap={8}>
      <XStack wrap gap={12}>
        <Link to="/p/$projectId" params={{ projectId }}>
          エピソード一覧
        </Link>
        <EpisodeTitle episode={episode} apply={apply} />
        <Button size="small" variant="ghost" onClick={() => setRemovingEpisode(true)}>
          エピソードを削除
        </Button>
      </XStack>
      {removingEpisode && (
        <RemoveEpisodeDialog
          episode={episode}
          onConfirm={() => {
            setRemovingEpisode(false)
            if (apply('エピソードを削除', (p) => removeEpisodePatch(p, episode.id)))
              void navigate({ to: '/p/$projectId', params: { projectId } })
          }}
          onCancel={() => setRemovingEpisode(false)}
        />
      )}
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
      <ol className={`${common.cards} ${styles.pages}`}>
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
                  ←
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  aria-label="後ろへ"
                  disabled={index === pages.length - 1}
                  onClick={() => apply('ページを移動', (p) => movePagePatch(p, page.id, 1))}
                >
                  →
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => setRemovingPage({ id: page.id, number: index + 1 })}
                >
                  削除
                </Button>
              </XStack>
            </YStack>
          )
        })}
      </ol>
      {removingPage && (
        <ConfirmDialog
          title="ページを削除"
          message={`${removingPage.number} ページを削除しますか？`}
          confirmLabel="削除"
          onConfirm={() => {
            apply('ページを削除', (p) => removePagePatch(p, removingPage.id))
            setRemovingPage(undefined)
          }}
          onCancel={() => setRemovingPage(undefined)}
        />
      )}
    </YStack>
  )
}

/** 話の名前の見出し。「名前を変更」で入力欄に替わり、保存すると Undo で戻せる変更として反映する */
function EpisodeTitle({
  episode,
  apply,
}: {
  episode: Episode
  apply: ReturnType<typeof useApplyPatch>['apply']
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(episode.title)
  if (!editing) {
    return (
      <>
        <Typography variant="heading">{episode.title}</Typography>
        <Button
          size="small"
          variant="ghost"
          onClick={() => {
            setTitle(episode.title)
            setEditing(true)
          }}
        >
          名前を変更
        </Button>
      </>
    )
  }
  return (
    <XStack
      as="form"
      wrap
      gap={8}
      onSubmit={(e) => {
        e.preventDefault()
        if (apply('話の名前を変更', (p) => renameEpisodePatch(p, episode.id, title)))
          setEditing(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setEditing(false)
      }}
    >
      <Input
        label="話の名前"
        hideLabel
        required
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
        // 「名前を変更」を押した直後に打ち始められるようにする
        autoFocus
      />
      <Button type="submit" size="small" variant="primary">
        保存
      </Button>
      <Button size="small" variant="ghost" onClick={() => setEditing(false)}>
        キャンセル
      </Button>
    </XStack>
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
