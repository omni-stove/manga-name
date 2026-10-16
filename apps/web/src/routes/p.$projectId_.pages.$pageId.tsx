import { EditorCanvas, type Layers, type Selection, type Tool } from '@manga/editor-canvas'
import type { ID } from '@manga/schema'
import { createFileRoute, Link, notFound, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { useStore } from 'zustand'
import { findPage, pagePatch } from '../project-ops'
import { useAssetResolver } from '../use-asset-resolver'
import { useApplyPatch, useProject } from '../use-project'

export const Route = createFileRoute('/p/$projectId_/pages/$pageId')({
  loader: async ({ context, params }) => {
    const store = await context.library.open(params.projectId)
    if (!store || !findPage(store.get(), params.pageId)) throw notFound()
    return { store }
  },
  component: Editor,
  notFoundComponent: PageNotFound,
})

const TOOLS: readonly { value: Tool; label: string }[] = [
  { value: 'select', label: '選択' },
  { value: 'panel', label: 'コマ' },
  { value: 'bubble', label: 'フキダシ' },
  { value: 'focus', label: '焦点' },
  { value: 'vector', label: 'ベクトル' },
  { value: 'scribble', label: '手描き' },
]

const LAYERS: readonly { key: keyof Layers; label: string }[] = [
  { key: 'reference', label: '参考' },
  { key: 'art', label: '絵' },
  { key: 'scribble', label: '手描き' },
  { key: 'hints', label: 'ヒント' },
  { key: 'diagnosis', label: '診断' },
]

const ALL_LAYERS: Layers = {
  reference: true,
  art: true,
  scribble: true,
  hints: true,
  diagnosis: true,
}

// 生成の配線（タスク 13）が入るまで、生成中のコマは無い
const NO_GENERATING = new Set<ID>()

function Editor() {
  const { projectId, pageId } = Route.useParams()
  const { store } = Route.useLoaderData()
  const { library } = Route.useRouteContext()
  const project = useProject(store)
  const { canUndo, canRedo } = useStore(store.state)
  const { apply, error } = useApplyPatch(store)
  const resolveAsset = useAssetResolver(library.resolveAsset)
  const [tool, setTool] = useState<Tool>('select')
  const [layers, setLayers] = useState<Layers>(ALL_LAYERS)
  const [selection, setSelection] = useState<Selection>(null)
  const found = findPage(project, pageId)
  // 開いている間に Undo や別タブの操作でページが消えることがある
  if (!found) return <PageNotFound />
  const { page, pageIndex } = found
  return (
    <section className="editor">
      <header className="toolbar">
        <Link to="/p/$projectId" params={{ projectId }}>
          ← {project.title || '無題'}
        </Link>
        <span>{pageIndex + 1} ページ</span>
        <fieldset className="tool-group">
          <legend>ツール</legend>
          {TOOLS.map((t) => (
            <label key={t.value}>
              <input
                type="radio"
                name="tool"
                value={t.value}
                checked={tool === t.value}
                onChange={() => setTool(t.value)}
              />
              {t.label}
            </label>
          ))}
        </fieldset>
        <fieldset className="tool-group">
          <legend>レイヤー</legend>
          {LAYERS.map((l) => (
            <label key={l.key}>
              <input
                type="checkbox"
                checked={layers[l.key]}
                onChange={(e) => setLayers({ ...layers, [l.key]: e.target.checked })}
              />
              {l.label}
            </label>
          ))}
        </fieldset>
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
      {error && <p className="error">{error}</p>}
      <div className="editor-body">
        <div className="canvas">
          <EditorCanvas
            page={page}
            settings={project.settings}
            characters={project.characters}
            diagnosis={null}
            selection={selection}
            tool={tool}
            layers={layers}
            generating={NO_GENERATING}
            onChange={(patch) => apply('キャンバスの編集', (p) => pagePatch(p, pageId, patch))}
            onSelect={setSelection}
            resolveAsset={resolveAsset}
          />
        </div>
        <aside className="inspector-placeholder">
          <h2>インスペクタ</h2>
          <p className="placeholder">
            コマ {page.panels.length} / フキダシ{' '}
            {page.panels.reduce((n, panel) => n + panel.bubbles.length, 0)}
          </p>
          <pre>{JSON.stringify(selection, null, 2)}</pre>
        </aside>
      </div>
    </section>
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
