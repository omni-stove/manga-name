import { EditorCanvas, type Layers, type Selection, type Tool } from '@manga/editor-canvas'
import {
  BubbleInspector,
  CharacterInspector,
  PageInspector,
  PanelInspector,
  ProjectSettingsInspector,
} from '@manga/inspector'
import type { Character, ID, Page, Panel, Patch, Project } from '@manga/schema'
import { createFileRoute, Link, notFound, useParams } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useStore } from 'zustand'
import {
  bubblePatch,
  characterPatch,
  findBubble,
  findPanel,
  panelPatch,
  removeArtPatch,
  settingsInspectorPatch,
} from '../inspector-ops'
import type { ProjectLibrary } from '../project-library'
import { findPage, pagePatch } from '../project-ops'
import { errorMessage } from '../route-error'
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

// ページ一括の生成はタスク 20。それまで「このページを全部生成」は何もしない
const notWired = () => {}

type Apply = (label: string, build: (project: Project) => Patch) => boolean
type Generate = (panelId: ID, instruction?: string) => void

const formatDate = (iso: string) => new Date(iso).toLocaleString('ja-JP')

function Editor() {
  const { projectId, pageId } = Route.useParams()
  const { store } = Route.useLoaderData()
  const { library, generation } = Route.useRouteContext()
  const project = useProject(store)
  const { canUndo, canRedo } = useStore(store.state)
  const { panels: generating } = useStore(generation.generating)
  const { apply, error } = useApplyPatch(store)
  const resolveAsset = useAssetResolver(library.resolveAsset)
  const [tool, setTool] = useState<Tool>('select')
  const [layers, setLayers] = useState<Layers>(ALL_LAYERS)
  const [selection, setSelection] = useState<Selection>(null)
  const found = findPage(project, pageId)
  // 開いている間に Undo や別タブの操作でページが消えることがある
  if (!found) return <PageNotFound />
  const { page, pageIndex } = found
  // 結果は generation がトーストと Patch で出すので、ここでは待たない
  const generate: Generate = (panelId, instruction) =>
    void generation.generate({ store, projectId, pageId, panelId, instruction })
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
            generating={generating}
            onChange={(patch) => apply('キャンバスの編集', (p) => pagePatch(p, pageId, patch))}
            onSelect={setSelection}
            onGenerate={generate}
            resolveAsset={resolveAsset}
          />
        </div>
        <aside className="inspector">
          <h2>インスペクタ</h2>
          <SelectionInspector
            page={page}
            pageId={pageId}
            characters={project.characters}
            selection={selection}
            generating={generating}
            apply={apply}
            generate={generate}
            resolveAsset={resolveAsset}
          />
          <details open={selection === null}>
            <summary>ページ</summary>
            <PageInspector
              page={page}
              generating={page.panels.some((panel) => generating.has(panel.id))}
              onChange={(patch) => apply('ページを編集', (p) => pagePatch(p, pageId, patch))}
              onGenerateAll={notWired}
            />
          </details>
          <details>
            <summary>キャラクター（{project.characters.length}）</summary>
            {project.characters.length === 0 && (
              <p className="placeholder">
                <Link to="/p/$projectId/characters" params={{ projectId }}>
                  キャラクター一覧
                </Link>
                で追加できます
              </p>
            )}
            {project.characters.map((character) => (
              <CharacterPane
                key={character.id}
                character={character}
                projectId={projectId}
                library={library}
                apply={apply}
                resolveAsset={resolveAsset}
              />
            ))}
          </details>
          <details>
            <summary>プロジェクト設定</summary>
            <ProjectSettingsInspector
              settings={project.settings}
              onChange={(patch) =>
                apply('プロジェクト設定を変更', () => settingsInspectorPatch(patch))
              }
            />
          </details>
        </aside>
      </div>
    </section>
  )
}

/** 選択中の要素のフォーム。何も選んでいなければ案内だけ出す */
function SelectionInspector({
  page,
  pageId,
  characters,
  selection,
  generating,
  apply,
  generate,
  resolveAsset,
}: {
  page: Page
  pageId: ID
  characters: Character[]
  selection: Selection
  generating: Set<ID>
  apply: Apply
  generate: Generate
  resolveAsset(ref: string): Promise<string>
}) {
  if (selection === null) {
    return <p className="placeholder">キャンバスでコマかフキダシを選ぶと、ここで編集できます</p>
  }
  if (selection.kind === 'panel') {
    const found = findPanel(page, selection.id)
    if (!found) return <p className="placeholder">選んだコマはもうありません</p>
    return (
      <>
        <PanelInspector
          key={selection.id}
          panel={found.panel}
          characters={characters}
          generating={generating.has(selection.id)}
          onChange={(patch) =>
            apply('コマを編集', (p) => panelPatch(p, pageId, selection.id, patch))
          }
          onGenerate={(instruction) => generate(selection.id, instruction)}
          resolveAsset={resolveAsset}
        />
        <ArtRemoval panel={found.panel} pageId={pageId} apply={apply} />
      </>
    )
  }
  if (selection.kind === 'bubble') {
    const found = findBubble(page, selection.id)
    if (!found) return <p className="placeholder">選んだフキダシはもうありません</p>
    return (
      <BubbleInspector
        key={selection.id}
        bubble={found.bubble}
        characters={characters}
        onChange={(patch) =>
          apply('フキダシを編集', (p) => bubblePatch(p, pageId, selection.id, patch))
        }
      />
    )
  }
  // 焦点とベクトルのフォームは Phase 2（タスク 30）
  return <p className="placeholder">この要素の編集は未対応です</p>
}

/** 履歴の削除。採用中の絵は消せないので、それ以外だけ並べる。アセットは残し、Undo で戻せる */
function ArtRemoval({ panel, pageId, apply }: { panel: Panel; pageId: ID; apply: Apply }) {
  const removable = panel.arts.filter((art) => art.id !== panel.artId).reverse()
  if (removable.length === 0) return null
  return (
    <details className="inspector-section" data-inspector="art-removal">
      <summary>履歴の削除（{removable.length}）</summary>
      <ul className="in-art-remove">
        {removable.map((art) => (
          <li key={art.id} data-art-id={art.id}>
            <span className="in-ellipsis">
              <time dateTime={art.createdAt}>{formatDate(art.createdAt)}</time>
              {art.instruction && ` ${art.instruction}`}
            </span>
            <button
              type="button"
              onClick={() => apply('絵を削除', (p) => removeArtPatch(p, pageId, panel.id, art.id))}
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** CharacterInspector に、参照画像を選ぶファイルダイアログと putAsset を付ける */
function CharacterPane({
  character,
  projectId,
  library,
  apply,
  resolveAsset,
}: {
  character: Character
  projectId: ID
  library: ProjectLibrary
  apply: Apply
  resolveAsset(ref: string): Promise<string>
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [pickError, setPickError] = useState<string>()
  return (
    <>
      <CharacterInspector
        character={character}
        onChange={(patch) =>
          apply('キャラクターを編集', (p) => characterPatch(p, character.id, patch))
        }
        onPickReference={() => fileInput.current?.click()}
        resolveAsset={resolveAsset}
      />
      {pickError && (
        <p className="error" role="alert">
          {pickError}
        </p>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          // 同じファイルを選び直しても change が出るように空にする
          e.target.value = ''
          if (!file) return
          library.putAsset(projectId, file, `reference-${character.id}`).then(
            (ref) => {
              setPickError(undefined)
              apply('参照画像を差し替え', (p) =>
                characterPatch(p, character.id, [{ op: 'add', path: '/referenceRef', value: ref }]),
              )
            },
            (err) => setPickError(errorMessage(err)),
          )
        }}
      />
    </>
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
