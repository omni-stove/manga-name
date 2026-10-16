import type { Episode, PageTemplate } from '@manga/schema'
import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { BatchOptions, useBatchGeneration } from '../batch-generation'
import { PeerBadge, usePeers } from '../collaboration-view'
import { PageThumbnail } from '../page-thumbnail'
import {
  addEpisodePatch,
  addPagePatch,
  artStatus,
  movePagePatch,
  PAGE_TEMPLATES,
  removePagePatch,
} from '../project-ops'
import type { ProjectStore } from '../store/project-store'
import { useApplyPatch, useProject } from '../use-project'

export const Route = createFileRoute('/p/$projectId/')({ component: PageList })

const projectRoute = getRouteApi('/p/$projectId')

function PageList() {
  const { projectId } = Route.useParams()
  const { store, collab } = projectRoute.useLoaderData()
  const { library } = Route.useRouteContext()
  const project = useProject(store)
  const peers = usePeers(collab)
  const { apply, error } = useApplyPatch(store)
  const [template, setTemplate] = useState<PageTemplate>('3rows')
  const [episodeId, setEpisodeId] = useState<string>()
  const targetEpisode = project.episodes.find((e) => e.id === episodeId) ?? project.episodes.at(-1)
  // rtl の本では先のページが左にあるので、並べ替えのボタンを向きに合わせる
  const [earlier, later] = project.settings.direction === 'rtl' ? ['→', '←'] : ['←', '→']

  return (
    <>
      <h2>ページ一覧</h2>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          apply('ページを追加', (p) => addPagePatch(p, template, targetEpisode?.id).patch)
        }}
      >
        <label>
          テンプレート{' '}
          <select
            value={template}
            onChange={(e) => setTemplate(e.currentTarget.value as PageTemplate)}
          >
            {PAGE_TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {project.episodes.length > 1 && (
          <label>
            追加先{' '}
            <select value={targetEpisode?.id} onChange={(e) => setEpisodeId(e.currentTarget.value)}>
              {project.episodes.map((episode) => (
                <option key={episode.id} value={episode.id}>
                  {episode.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit">ページを追加</button>
        <button type="button" onClick={() => apply('エピソードを追加', addEpisodePatch)}>
          エピソードを追加
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {project.episodes.length === 0 && <p>まだページがありません。</p>}
      {project.episodes.map((episode) => (
        <article key={episode.id}>
          <h3>{episode.title}</h3>
          <EpisodeBatch episode={episode} projectId={projectId} store={store} />
          {episode.pages.length === 0 && <p>ページがありません。</p>}
          <ol className="cards">
            {episode.pages.map((page, index) => {
              const status = artStatus(page)
              const editing = peers.filter((peer) => peer.pageId === page.id)
              return (
                <li key={page.id}>
                  <Link to="/p/$projectId/pages/$pageId" params={{ projectId, pageId: page.id }}>
                    <PageThumbnail
                      page={page}
                      pageSize={project.settings.pageSize}
                      resolveAsset={library.resolveAsset}
                    />
                    <strong>{index + 1} ページ</strong>
                  </Link>
                  {editing.length > 0 && (
                    <fieldset className="peers" aria-label="編集中の人">
                      {editing.map((peer) => (
                        <PeerBadge key={peer.clientId} name={peer.name} color={peer.color} />
                      ))}
                    </fieldset>
                  )}
                  <small>
                    コマ {page.panels.length} / 生成{' '}
                    <span className="art-status" data-status={status}>
                      {status}
                    </span>
                  </small>
                  <span className="card-actions">
                    <button
                      type="button"
                      aria-label="前へ"
                      disabled={index === 0}
                      onClick={() => apply('ページを移動', (p) => movePagePatch(p, page.id, -1))}
                    >
                      {earlier}
                    </button>
                    <button
                      type="button"
                      aria-label="後ろへ"
                      disabled={index === episode.pages.length - 1}
                      onClick={() => apply('ページを移動', (p) => movePagePatch(p, page.id, 1))}
                    >
                      {later}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(`${index + 1} ページを削除しますか？`)) return
                        apply('ページを削除', (p) => removePagePatch(p, page.id))
                      }}
                    >
                      削除
                    </button>
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
    <div className="toolbar">
      <button
        type="button"
        disabled={batch.running || episode.pages.length === 0}
        onClick={batch.start}
      >
        {batch.running ? '生成中…' : '全部生成'}
      </button>
      <BatchOptions batch={batch} />
    </div>
  )
}
