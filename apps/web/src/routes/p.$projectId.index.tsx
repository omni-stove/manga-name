import type { Episode, PageTemplate } from '@manga/schema'
import { Button, Select } from '@manga/ui'
import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useStore } from 'zustand'
import { BatchOptions, useBatchGeneration } from '../batch-generation'
import { PeerBadge, usePeers } from '../collaboration-view'
import collabStyles from '../collaboration-view.module.css'
import common from '../common.module.css'
import { PageThumbnail } from '../page-thumbnail'
import {
  addEpisodePatch,
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

export const Route = createFileRoute('/p/$projectId/')({ component: PageList })

const projectRoute = getRouteApi('/p/$projectId')

function PageList() {
  const { projectId } = Route.useParams()
  const { store, collab } = projectRoute.useLoaderData()
  const { library, llmProvider } = Route.useRouteContext()
  const project = useProject(store)
  const { canUndo, canRedo } = useStore(store.state)
  const peers = usePeers(collab)
  const { apply, error } = useApplyPatch(store)
  const [template, setTemplate] = useState<PageTemplate>('3rows')
  const [episodeId, setEpisodeId] = useState<string>()
  const [drafting, setDrafting] = useState(false)
  useUndoShortcuts(store)
  const targetEpisode = project.episodes.find((e) => e.id === episodeId) ?? project.episodes.at(-1)
  // rtl の本では先のページが左にあるので、並べ替えのボタンを向きに合わせる
  const [earlier, later] = project.settings.direction === 'rtl' ? ['→', '←'] : ['←', '→']

  return (
    <>
      <h2>ページ一覧</h2>
      <form
        className={common.toolbar}
        onSubmit={(e) => {
          e.preventDefault()
          apply('ページを追加', (p) => addPagePatch(p, template, targetEpisode?.id).patch)
        }}
      >
        {/* biome-ignore lint/a11y/noLabelWithoutControl: Select は label の内側に入る */}
        <label className={styles.inline}>
          テンプレート
          <Select
            value={template}
            onChange={(e) => setTemplate(e.currentTarget.value as PageTemplate)}
          >
            {PAGE_TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        {project.episodes.length > 1 && (
          // biome-ignore lint/a11y/noLabelWithoutControl: Select は label の内側に入る
          <label className={styles.inline}>
            追加先
            <Select value={targetEpisode?.id} onChange={(e) => setEpisodeId(e.currentTarget.value)}>
              {project.episodes.map((episode) => (
                <option key={episode.id} value={episode.id}>
                  {episode.title}
                </option>
              ))}
            </Select>
          </label>
        )}
        <Button type="submit" variant="primary">
          ページを追加
        </Button>
        <Button onClick={() => apply('エピソードを追加', addEpisodePatch)}>エピソードを追加</Button>
        <Button onClick={() => setDrafting(true)}>脚本から下書き</Button>
        <span className={common.actions}>
          <Button size="small" variant="ghost" disabled={!canUndo} onClick={() => store.undo()}>
            Undo
          </Button>
          <Button size="small" variant="ghost" disabled={!canRedo} onClick={() => store.redo()}>
            Redo
          </Button>
        </span>
      </form>
      {drafting && (
        <ScriptDraftDialog
          project={project}
          store={store}
          llmProvider={llmProvider}
          episodeId={targetEpisode?.id}
          onClose={() => setDrafting(false)}
        />
      )}
      {error && (
        <p className={common.error} role="alert">
          {error}
        </p>
      )}
      {project.episodes.length === 0 && (
        <p className={common.placeholder}>まだページがありません。</p>
      )}
      {project.episodes.map((episode) => (
        <article key={episode.id} className={styles.episode}>
          <h3 className={styles.episodeTitle}>{episode.title}</h3>
          <EpisodeBatch episode={episode} projectId={projectId} store={store} />
          {episode.pages.length === 0 && <p className={common.placeholder}>ページがありません。</p>}
          <ol
            className={`${common.cards} ${styles.pages}`}
            data-direction={project.settings.direction}
          >
            {episode.pages.map((page, index) => {
              const status = artStatus(page)
              const editing = peers.filter((peer) => peer.pageId === page.id)
              return (
                <li key={page.id} className={common.card}>
                  <Link
                    to="/p/$projectId/pages/$pageId"
                    params={{ projectId, pageId: page.id }}
                    className={common.cardLink}
                  >
                    <PageThumbnail
                      page={page}
                      pageSize={project.settings.pageSize}
                      resolveAsset={library.resolveAsset}
                    />
                    <strong>{index + 1} ページ</strong>
                  </Link>
                  {editing.length > 0 && (
                    <fieldset className={collabStyles.peers} aria-label="編集中の人">
                      {editing.map((peer) => (
                        <PeerBadge key={peer.clientId} name={peer.name} color={peer.color} />
                      ))}
                    </fieldset>
                  )}
                  <small className={styles.meta}>
                    コマ {page.panels.length} / 生成{' '}
                    <span className={styles.status} data-status={status}>
                      {status}
                    </span>
                  </small>
                  <span className={common.cardActions}>
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
                      disabled={index === episode.pages.length - 1}
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
                  </span>
                </li>
              )
            })}
          </ol>
        </article>
      ))}
    </>
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
    <div className={common.toolbar}>
      <Button disabled={batch.running || episode.pages.length === 0} onClick={batch.start}>
        {batch.running ? '生成中…' : '全部生成'}
      </Button>
      <BatchOptions batch={batch} />
    </div>
  )
}
