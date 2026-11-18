import { m } from '@manga/i18n'
import {
  type Episode,
  type PageSlot,
  type Project,
  pageCharacterIds,
  pageSlots,
} from '@manga/schema'
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  IconButton,
  Input,
  RemoveButton,
  Typography,
  XStack,
  YStack,
} from '@manga/ui'
import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { BackLink } from '../back-link'
import { PeerBadge, usePeers } from '../collaboration-view'
import collabStyles from '../collaboration-view.module.css'
import common from '../common.module.css'
import { AddPageDialog } from '../layout-templates'
import { PageThumbnail } from '../page-thumbnail'
import {
  ART_STATUS_LABELS,
  artStatus,
  canMovePage,
  canRemovePage,
  canSetStartsRight,
  movePagePatch,
  removeEpisodePatch,
  removePagePatch,
  renameEpisodePatch,
  startsRightPatch,
} from '../project-ops'
import { RemoveEpisodeDialog } from '../remove-episode-dialog'
import { GearIcon } from '../side-nav'
import { useAssetResolver } from '../use-asset-resolver'
import { useApplyPatch, useProject } from '../use-project'
import styles from './pages.module.css'

export const Route = createFileRoute('/p/$projectId/episodes/$episodeId')({
  component: EpisodePages,
})

const projectRoute = getRouteApi('/p/$projectId')

/**
 * 1 話分の見出し、ページの追加と下書き、ページのカードを並べる。
 * ページの追加はダイアログ（AddPageDialog）でコマ割りや見開きを見比べて選ぶ。見開きには紙面いっぱいの枠なしのコマが 1 つ入る。
 * 1 ページ目は左ページで、歯車のエピソード設定の「右ページから始める」で右にできる。
 * カードにはノンブルと左右を出し、見開きは 2 枚分の幅で並べる。
 * 見開きを割る移動、削除、始まりの切り替えはできない
 */
function EpisodePages() {
  const { projectId, episodeId } = Route.useParams()
  const { store, collab } = projectRoute.useLoaderData()
  const { library } = Route.useRouteContext()
  const resolveAsset = useAssetResolver(library.resolveAsset)
  const project = useProject(store)
  const peers = usePeers(collab)
  const { apply, error } = useApplyPatch(store)
  const [addingPage, setAddingPage] = useState(false)
  const [editingSettings, setEditingSettings] = useState(false)
  const [removingEpisode, setRemovingEpisode] = useState(false)
  /** 確認中のページの id と、確認の文言に出すノンブル */
  const [removingPage, setRemovingPage] = useState<{ id: string; label: string }>()
  const navigate = useNavigate()
  const episode = project.episodes.find((e) => e.id === episodeId)
  // 開いている間に Undo や他の人の操作でエピソードが消えることがある
  if (!episode) return <EpisodeNotFound projectId={projectId} />
  const pages = episode.pages

  return (
    <YStack gap={8}>
      <YStack as="header" gap={4}>
        <BackLink to="/p/$projectId" params={{ projectId }}>
          {m.web_episode_list()}
        </BackLink>
        <XStack gap={4}>
          <Typography variant="heading">{episode.title}</Typography>
          <IconButton label={m.web_episode_settings()} onClick={() => setEditingSettings(true)}>
            <GearIcon />
          </IconButton>
        </XStack>
      </YStack>
      {editingSettings && (
        <EpisodeSettingsDialog
          project={project}
          episode={episode}
          apply={apply}
          error={error}
          onRemove={() => {
            setEditingSettings(false)
            setRemovingEpisode(true)
          }}
          onClose={() => setEditingSettings(false)}
        />
      )}
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
      <XStack wrap gap={12} className={common.toolbar}>
        <Button variant="primary" onClick={() => setAddingPage(true)}>
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
      {addingPage && (
        <AddPageDialog
          project={project}
          episodeId={episode.id}
          apply={apply}
          onAdded={() => setAddingPage(false)}
          onClose={() => setAddingPage(false)}
        />
      )}
      {pages.length === 0 && <Typography tone="muted">{m.web_episode_no_pages()}</Typography>}
      <ol className={`${common.cards} ${styles.pages}`}>
        {pageSlots(episode).map((slot) => {
          const { page } = slot
          const status = artStatus(page)
          const cast = pageCharacterIds(page).flatMap((id) =>
            project.characters.filter((c) => c.id === id).map((c) => c.name),
          )
          const editing = peers.filter((peer) => peer.pageId === page.id)
          return (
            <YStack
              as="li"
              gap={6}
              key={page.id}
              className={common.card}
              data-spread={page.spread || undefined}
            >
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
                  <strong>{slotLabel(slot)}</strong>
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
                {slot.side !== 'spread' && `${SIDE_LABELS[slot.side]()} `}
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
                  disabled={!canMovePage(project, page.id, -1)}
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
                  disabled={!canMovePage(project, page.id, 1)}
                  onClick={() =>
                    apply(m.web_episode_move_page(), (p) => movePagePatch(p, page.id, 1))
                  }
                >
                  →
                </Button>
                <RemoveButton
                  size="small"
                  label={m.remove()}
                  disabled={!canRemovePage(project, page.id)}
                  onClick={() => setRemovingPage({ id: page.id, label: slotLabel(slot) })}
                />
              </XStack>
            </YStack>
          )
        })}
      </ol>
      {removingPage && (
        <ConfirmDialog
          title={m.web_episode_remove_page()}
          message={m.web_episode_remove_page_confirm({ page: removingPage.label })}
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

/**
 * エピソード全体の設定。タイトルと始まりの左右は保存でまとめて 1 回の Undo になり、キャンセルでは変えない。
 * 削除はここからだけ押せ、押すとこの dialog を閉じて削除の確認に移る
 */
function EpisodeSettingsDialog({
  project,
  episode,
  apply,
  error,
  onRemove,
  onClose,
}: {
  project: Project
  episode: Episode
  apply: ReturnType<typeof useApplyPatch>['apply']
  error: string | undefined
  onRemove(): void
  onClose(): void
}) {
  const [title, setTitle] = useState(episode.title)
  const [startsRight, setStartsRight] = useState(episode.startsRight === true)
  const canToggle = canSetStartsRight(project, episode.id, !startsRight)
  return (
    <Dialog
      title={m.web_episode_settings()}
      onClose={onClose}
      onSubmit={() => {
        if (
          apply(m.web_episode_settings_history(), (p) => [
            ...renameEpisodePatch(p, episode.id, title),
            ...startsRightPatch(p, episode.id, startsRight),
          ])
        )
          onClose()
      }}
      actions={
        <>
          <Button onClick={onClose}>{m.cancel()}</Button>
          <Button type="submit" variant="primary">
            {m.save()}
          </Button>
        </>
      }
    >
      <YStack gap={16}>
        <Input
          label={m.episode_title()}
          required
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          autoFocus
        />
        <Checkbox
          label={m.web_episode_starts_right()}
          checked={startsRight}
          disabled={!canToggle}
          title={canToggle ? undefined : m.web_episode_spread_breaks()}
          onChange={(e) => setStartsRight(e.currentTarget.checked)}
        />
        {error && (
          <Typography tone="alert" role="alert">
            {error}
          </Typography>
        )}
        <XStack>
          <Button variant="danger" onClick={onRemove}>
            {m.web_episode_remove()}
          </Button>
        </XStack>
      </YStack>
    </Dialog>
  )
}

/** カードに出すノンブル。見開きは 2 つのノンブルを並べる */
function slotLabel({ number, side }: PageSlot): string {
  return side === 'spread'
    ? m.web_episode_spread_number({ from: number, to: number + 1 })
    : m.web_episode_page_number({ number })
}

const SIDE_LABELS = {
  left: m.web_episode_page_side_left,
  right: m.web_episode_page_side_right,
} as const

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
