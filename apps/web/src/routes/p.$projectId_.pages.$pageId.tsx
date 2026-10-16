import type { ID, Page } from '@manga/schema'
import { createFileRoute, Link, notFound, useParams } from '@tanstack/react-router'
import { type CSSProperties, useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { CollaborationBar, PeerBadge, peerColor, usePeers } from '../collaboration-view'
import { findPage } from '../project-ops'
import type { Peer } from '../store/presence'
import { useProject } from '../use-project'

export const Route = createFileRoute('/p/$projectId_/pages/$pageId')({
  loader: async ({ context, params }) => {
    const store = await context.library.open(params.projectId)
    if (!store || !findPage(store.get(), params.pageId)) throw notFound()
    return { store, collab: context.library.collaboration(params.projectId) }
  },
  component: Editor,
  notFoundComponent: PageNotFound,
})

const NO_SELECTION: ID[] = []

function Editor() {
  const { projectId, pageId } = Route.useParams()
  const { store, collab } = Route.useLoaderData()
  const project = useProject(store)
  const { canUndo, canRedo } = useStore(store.state)
  const peers = usePeers(collab)
  const [selection, setSelection] = useState<ID[]>(NO_SELECTION)
  const found = findPage(project, pageId)
  // 他のクライアントの操作でページや要素が消えることがあるので、今のページにある id だけを選択として扱う
  const onPage = new Set(found?.page.panels.flatMap((p) => [p.id, ...p.bubbles.map((b) => b.id)]))
  const selected = selection.filter((id) => onPage.has(id))
  // selected は描画のたびに作り直されるので、effect の依存には中身を表す文字列を使う
  const selectedKey = selected.join('\n')

  useEffect(() => {
    collab?.presence.setLocation({
      pageId,
      selection: selectedKey === '' ? [] : selectedKey.split('\n'),
    })
  }, [collab, pageId, selectedKey])
  useEffect(() => () => collab?.presence.setLocation({ pageId: null, selection: [] }), [collab])

  // 開いている間に Undo や別タブの操作でページが消えることがある
  if (!found) return <PageNotFound />
  const { page, pageIndex } = found
  const toggle = (id: ID) => setSelection((s) => (s.length === 1 && s[0] === id ? [] : [id]))
  return (
    <section className="editor">
      <header className="toolbar">
        <Link to="/p/$projectId" params={{ projectId }}>
          ← {project.title || '無題'}
        </Link>
        <span>{pageIndex + 1} ページ</span>
        <CollaborationBar collab={collab} project={project} />
        <span className="toolbar-actions">
          <button type="button" disabled={!canUndo} onClick={() => store.undo()}>
            Undo
          </button>
          <button type="button" disabled={!canRedo} onClick={() => store.redo()}>
            Redo
          </button>
          <button type="button" disabled>
            書き出し
          </button>
        </span>
      </header>
      <div className="editor-body">
        <div className="canvas-placeholder">
          <p>キャンバス（EditorCanvas）</p>
          <p>
            コマ {page.panels.length} / フキダシ{' '}
            {page.panels.reduce((n, panel) => n + panel.bubbles.length, 0)}
          </p>
        </div>
        <aside className="inspector-placeholder">
          <h2>インスペクタ</h2>
          <ElementList
            page={page}
            selected={selected}
            selfColor={collab?.presence.color}
            peers={peers.filter((peer) => peer.pageId === page.id)}
            onToggle={toggle}
          />
          <pre>{JSON.stringify(page, null, 2)}</pre>
        </aside>
      </div>
    </section>
  )
}

/** ページのコマとフキダシ。押すと選択し、他のクライアントが選んでいるものはその人のカーソル色で囲む */
function ElementList({
  page,
  selected,
  selfColor = 'currentColor',
  peers,
  onToggle,
}: {
  page: Page
  selected: ID[]
  selfColor?: string
  peers: Peer[]
  onToggle(id: ID): void
}) {
  const element = (id: ID, label: string) => {
    const by = peers.filter((peer) => peer.selection.includes(id))
    const style = {
      '--self-color': selfColor,
      ...(by[0] ? peerColor(by[0].color) : {}),
    } as CSSProperties
    return (
      <button
        type="button"
        className="element"
        aria-pressed={selected.includes(id)}
        data-peer-selected={by.length > 0}
        style={style}
        onClick={() => onToggle(id)}
      >
        {label}
        {by.map((peer) => (
          <PeerBadge key={peer.clientId} name={peer.name} color={peer.color} />
        ))}
      </button>
    )
  }
  return (
    <ol className="element-list" aria-label="コマとフキダシ">
      {page.panels.map((panel, index) => (
        <li key={panel.id}>
          {element(panel.id, `コマ ${index + 1}`)}
          {panel.bubbles.length > 0 && (
            <ol>
              {panel.bubbles.map((bubble) => (
                <li key={bubble.id}>
                  {element(bubble.id, `フキダシ ${bubble.order}${bubble.text ? `「${bubble.text}」` : ''}`)}
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ol>
  )
}

function PageNotFound() {
  const { projectId, pageId } = useParams({ strict: false })
  return (
    <section>
      <h1>ページが見つかりません</h1>
      <p>
        {projectId} / {pageId}
      </p>
      {projectId ? (
        <Link to="/p/$projectId" params={{ projectId }}>
          ページ一覧へ
        </Link>
      ) : (
        <Link to="/">プロジェクト一覧へ</Link>
      )}
    </section>
  )
}
