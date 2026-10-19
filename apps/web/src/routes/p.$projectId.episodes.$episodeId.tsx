import { m } from '@manga/i18n'
import { type Episode, pageCharacterIds } from '@manga/schema'
import {
  Button,
  ConfirmDialog,
  IconButton,
  Input,
  RemoveButton,
  Typography,
  XStack,
  YStack,
} from '@manga/ui'
import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { BatchOptions, useBatchGeneration } from '../batch-generation'
import { PeerBadge, usePeers } from '../collaboration-view'
import collabStyles from '../collaboration-view.module.css'
import common from '../common.module.css'
import { Icon } from '../history-buttons'
import { TemplateSelect, useTemplateChoice } from '../layout-templates'
import { PageThumbnail } from '../page-thumbnail'
import {
  ART_STATUS_LABELS,
  addPagePatch,
  artStatus,
  movePagePatch,
  removeEpisodePatch,
  removeLayoutTemplatePatch,
  removePagePatch,
  renameEpisodePatch,
  resolveTemplate,
  templateOptions,
} from '../project-ops'
import { RemoveEpisodeDialog } from '../remove-episode-dialog'
import type { ProjectStore } from '../store/project-store-types'
import { useAssetResolver } from '../use-asset-resolver'
import { useApplyPatch, useProject } from '../use-project'
import styles from './pages.module.css'

export const Route = createFileRoute('/p/$projectId/episodes/$episodeId')({
  component: EpisodePages,
})

const projectRoute = getRouteApi('/p/$projectId')

/**
 * 1 話分の見出し、ページの追加と下書きと一括生成、ページのカードを並べる。
 * ページの追加では登録したコマ割りもテンプレートに選べ、選んでいるときは確認を経てその登録を消せる
 */
function EpisodePages() {
  const { projectId, episodeId } = Route.useParams()
  const { store, collab } = projectRoute.useLoaderData()
  const { library } = Route.useRouteContext()
  const resolveAsset = useAssetResolver(library.resolveAsset)
  const project = useProject(store)
  const peers = usePeers(collab)
  const { apply, error } = useApplyPatch(store)
  const [template, setTemplate] = useTemplateChoice(project)
  const [removingEpisode, setRemovingEpisode] = useState(false)
  /** 確認中の登録したコマ割り */
  const [removingTemplate, setRemovingTemplate] = useState<{ id: string; name: string }>()
  /** 確認中のページの id と、確認の文言に出すページ番号 */
  const [removingPage, setRemovingPage] = useState<{ id: string; number: number }>()
  const navigate = useNavigate()
  const episode = project.episodes.find((e) => e.id === episodeId)
  // 開いている間に Undo や他の人の操作でエピソードが消えることがある
  if (!episode) return <EpisodeNotFound projectId={projectId} />
  const pages = episode.pages
  const registeredTemplate = templateOptions(project).find(
    (o) => o.registered && o.value === template,
  )

  return (
    <YStack gap={8}>
      <YStack as="header" gap={4}>
        <Link to="/p/$projectId" params={{ projectId }} className={styles.back}>
          <span aria-hidden>← </span>
          {m.web_episode_list()}
        </Link>
        <XStack gap={12} justify="between">
          <EpisodeTitle episode={episode} apply={apply} />
          <RemoveButton label={m.web_episode_remove()} onClick={() => setRemovingEpisode(true)} />
        </XStack>
      </YStack>
      {removingEpisode && (
        <RemoveEpisodeDialog
          episode={episode}
          onConfirm={() => {
            setRemovingEpisode(false)
            if (apply(m.web_episode_remove(), (p) => removeEpisodePatch(p, episode.id)))
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
          apply(
            m.web_episode_add_page(),
            (p) => addPagePatch(p, resolveTemplate(p, template), episode.id).patch,
          )
        }}
      >
        <TemplateSelect project={project} value={template} onChange={setTemplate} />
        {registeredTemplate && (
          <RemoveButton
            size="small"
            label={m.web_episode_remove_template()}
            onClick={() =>
              setRemovingTemplate({ id: registeredTemplate.value, name: registeredTemplate.label })
            }
          />
        )}
        <Button type="submit" variant="primary">
          {m.web_episode_add_page()}
        </Button>
        <Button
          data-guide="draft"
          onClick={() =>
            void navigate({
              to: '/p/$projectId/episodes/$episodeId/draft',
              params: { projectId, episodeId },
            })
          }
        >
          {m.web_draft_title()}
        </Button>
      </XStack>
      <EpisodeBatch episode={episode} projectId={projectId} store={store} />
      {pages.length === 0 && <Typography tone="muted">{m.web_episode_no_pages()}</Typography>}
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
                data-guide="page"
              >
                <YStack gap={4}>
                  <PageThumbnail
                    page={page}
                    pageSize={project.settings.pageSize}
                    resolveAsset={resolveAsset}
                  />
                  <strong>{m.web_episode_page_number({ number: index + 1 })}</strong>
                </YStack>
              </Link>
              {editing.length > 0 && (
                <XStack
                  as="fieldset"
                  wrap
                  gap={4}
                  align="stretch"
                  className={collabStyles.peers}
                  aria-label={m.web_episode_editing_peers()}
                >
                  {editing.map((peer) => (
                    <PeerBadge key={peer.clientId} name={peer.name} color={peer.color} />
                  ))}
                </XStack>
              )}
              <Typography as="small" variant="caption" tone="muted">
                {m.web_episode_page_summary({ panels: page.panels.length })}{' '}
                <span className={styles.status} data-status={status}>
                  {ART_STATUS_LABELS[status]()}
                </span>
              </Typography>
              {page.note !== undefined && (
                <Typography as="small" variant="caption" className={styles.note}>
                  {page.note}
                </Typography>
              )}
              {cast.length > 0 && (
                <Typography as="small" variant="caption" tone="muted" data-page-cast>
                  {m.web_episode_page_cast({ cast: cast.join('、') })}
                </Typography>
              )}
              <XStack as="span" wrap gap={6} className={common.cardActions}>
                <Button
                  size="small"
                  variant="ghost"
                  aria-label={m.web_episode_move_earlier()}
                  disabled={index === 0}
                  onClick={() =>
                    apply(m.web_episode_move_page(), (p) => movePagePatch(p, page.id, -1))
                  }
                >
                  ←
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  aria-label={m.web_episode_move_later()}
                  disabled={index === pages.length - 1}
                  onClick={() =>
                    apply(m.web_episode_move_page(), (p) => movePagePatch(p, page.id, 1))
                  }
                >
                  →
                </Button>
                <RemoveButton
                  size="small"
                  label={m.remove()}
                  onClick={() => setRemovingPage({ id: page.id, number: index + 1 })}
                />
              </XStack>
            </YStack>
          )
        })}
      </ol>
      {removingTemplate && (
        <ConfirmDialog
          title={m.web_episode_remove_template()}
          message={m.web_episode_remove_template_confirm({ name: removingTemplate.name })}
          confirmLabel={m.remove()}
          onConfirm={() => {
            apply(m.web_episode_remove_template(), (p) =>
              removeLayoutTemplatePatch(p, removingTemplate.id),
            )
            setRemovingTemplate(undefined)
          }}
          onCancel={() => setRemovingTemplate(undefined)}
        />
      )}
      {removingPage && (
        <ConfirmDialog
          title={m.web_episode_remove_page()}
          message={m.web_episode_remove_page_confirm({ number: removingPage.number })}
          confirmLabel={m.remove()}
          onConfirm={() => {
            apply(m.web_episode_remove_page(), (p) => removePagePatch(p, removingPage.id))
            setRemovingPage(undefined)
          }}
          onCancel={() => setRemovingPage(undefined)}
        />
      )}
    </YStack>
  )
}

/** 話の名前の見出し。横の鉛筆の「名前を変更」で入力欄に替わり、保存すると反映する */
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
      <XStack gap={4}>
        <Typography variant="heading">{episode.title}</Typography>
        <IconButton
          size="small"
          label={m.web_episode_rename()}
          onClick={() => {
            setTitle(episode.title)
            setEditing(true)
          }}
        >
          <Icon>
            <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />
          </Icon>
        </IconButton>
      </XStack>
    )
  }
  return (
    <XStack
      as="form"
      wrap
      gap={8}
      onSubmit={(e) => {
        e.preventDefault()
        if (apply(m.web_episode_rename_history(), (p) => renameEpisodePatch(p, episode.id, title)))
          setEditing(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setEditing(false)
      }}
    >
      <Input
        label={m.episode_title()}
        hideLabel
        required
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
        // 「名前を変更」を押した直後に打ち始められるようにする
        autoFocus
      />
      <Button type="submit" size="small" variant="primary">
        {m.save()}
      </Button>
      <Button size="small" variant="ghost" onClick={() => setEditing(false)}>
        {m.cancel()}
      </Button>
    </XStack>
  )
}

function EpisodeNotFound({ projectId }: { projectId: string }) {
  return (
    <YStack as="section" gap={16} align="start">
      <Typography variant="title">{m.web_episode_not_found()}</Typography>
      <Link to="/p/$projectId" params={{ projectId }}>
        {m.web_episode_back_to_list()}
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
        {batch.running ? m.generating() : m.web_episode_generate_all()}
      </Button>
      <BatchOptions batch={batch} />
    </XStack>
  )
}
