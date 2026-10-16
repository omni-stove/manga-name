import {
  EditorCanvas,
  type Layers,
  type ScribbleTool,
  type Selection,
  type Tool,
} from '@manga/editor-canvas'
import {
  BubbleInspector,
  CharacterInspector,
  PageInspector,
  PanelInspector,
  ProjectSettingsInspector,
} from '@manga/inspector'
import type { Character, ID, Page, Panel, Patch, Project } from '@manga/schema'
import { Button, Checkbox, SegmentedControl, ToolGroup } from '@manga/ui'
import { createFileRoute, Link, notFound, useParams } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { BatchOptions, useBatchGeneration } from '../batch-generation'
import { CollaborationBar, PeerBadge, peerColor, usePeers } from '../collaboration-view'
import common from '../common.module.css'
import { ExportDialog, type ExportOptions } from '../export-dialog'
import { downloadBlob, exportFileName, pageExporter } from '../export-page'
import { collectExportJob } from '../export-page-job'
import { generatingPanels, usesReference } from '../generate-panel'
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
import { firstFile, referencePatch, toReferenceImage } from '../reference-image'
import { errorMessage } from '../route-error'
import { SaveStatusIndicator } from '../save-status'
import { ROLE_LABELS } from '../sharing'
import type { Peer } from '../store/presence'
import { toasts } from '../toasts'
import { useAssetResolver } from '../use-asset-resolver'
import { useApplyPatch, useProject } from '../use-project'
import { useUndoShortcuts } from '../use-undo-shortcuts'
import styles from './editor.module.css'

export const Route = createFileRoute('/p/$projectId_/pages/$pageId')({
  loader: async ({ context, params }) => {
    const store = await context.library.open(params.projectId)
    if (!store || !findPage(store.get(), params.pageId)) throw notFound()
    return { store, collab: context.library.collaboration(params.projectId) }
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

const SCRIBBLE_TOOLS: readonly { value: ScribbleTool; label: string }[] = [
  { value: 'ink', label: '黒' },
  { value: 'red', label: '赤' },
  { value: 'blue', label: '青' },
  { value: 'eraser', label: '消しゴム' },
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

type Apply = (label: string, build: (project: Project) => Patch) => boolean
type Generate = (panelId: ID, instruction?: string) => void
/** コマの「参考画像を使う」。ページに参考画像が無ければ undefined */
interface ReferenceToggle {
  uses(panelId: ID): boolean | undefined
  set(panelId: ID, use: boolean): void
}

const REFERENCE_ACCEPT = 'image/png,image/jpeg,application/pdf'
/** 書き出しダイアログが開いているか、閉じて Worker が描いている最中か */
type Exporting = 'closed' | 'dialog' | 'busy'

const formatDate = (iso: string) => new Date(iso).toLocaleString('ja-JP')

/** 選択が指す要素がまだページにあるか。Delete や Undo で消えた要素の選択は無いものとして扱う */
function hasElement(page: Page, selection: Selection): boolean {
  if (selection === null) return false
  if (selection.kind === 'panel') return findPanel(page, selection.id) !== undefined
  if (selection.kind === 'bubble') return findBubble(page, selection.id) !== undefined
  return false
}

function Editor() {
  const { projectId, pageId } = Route.useParams()
  const { store, collab } = Route.useLoaderData()
  const { library, generation } = Route.useRouteContext()
  const project = useProject(store)
  const { canUndo, canRedo } = useStore(store.state)
  const generatingState = useStore(generation.generating)
  const generating = generatingPanels(generatingState, projectId)
  const referenceOptOut = useStore(generation.referenceOptOut)
  const { apply, error } = useApplyPatch(store)
  const resolveAsset = useAssetResolver(library.resolveAsset)
  const peers = usePeers(collab)
  const role = library.role(projectId) ?? 'owner'
  const canEdit = role === 'owner' || role === 'editor'
  // commenter は手描きメモだけ書けるので、選択と手描き以外のツールを出さない
  const tools = canEdit
    ? TOOLS
    : TOOLS.filter((t) => t.value === 'select' || (role === 'commenter' && t.value === 'scribble'))
  const [tool, setTool] = useState<Tool>('select')
  const [scribbleTool, setScribbleTool] = useState<ScribbleTool>('ink')
  const [layers, setLayers] = useState<Layers>(ALL_LAYERS)
  const [selected, setSelection] = useState<Selection>(null)
  const [exporting, setExporting] = useState<Exporting>('closed')
  useUndoShortcuts(store)
  const importReference = (file: Blob) => {
    toReferenceImage(file)
      .then((blob) => library.putAsset(projectId, blob, `reference-${pageId}`))
      .then(
        (ref) =>
          apply('参考画像を読み込み', (p) => {
            const current = findPage(p, pageId)
            if (!current) throw new Error('ページがもうありません')
            return pagePatch(p, pageId, referencePatch(current.page, ref))
          }),
        (err) => toasts.push(`参考画像を読み込めません: ${errorMessage(err)}`),
      )
  }
  useReferencePaste(importReference)
  const referencePicker = useFilePicker(REFERENCE_ACCEPT, importReference)
  const pageBatch = useBatchGeneration({
    generation,
    store,
    projectId,
    scope: `page/${pageId}`,
    pageIds: [pageId],
  })
  const found = findPage(project, pageId)
  // presence は早期 return より前に送るので、page を待たずに今ある要素の選択だけを選ぶ
  const selectedId = found && hasElement(found.page, selected) ? selected?.id : undefined

  useEffect(() => {
    collab?.presence.setLocation({ pageId, selection: selectedId ? [selectedId] : [] })
  }, [collab, pageId, selectedId])
  useEffect(() => () => collab?.presence.setLocation({ pageId: null, selection: [] }), [collab])

  // 開いている間に Undo や別タブの操作でページが消えることがある
  if (!found) return <PageNotFound />
  const { page, pageIndex } = found
  const selection = hasElement(page, selected) ? selected : null
  // 結果は generation がトーストと Patch で出すので、ここでは待たない
  const generate: Generate = (panelId, instruction) =>
    void generation.generate({ store, projectId, pageId, panelId, instruction })
  const referenceToggle: ReferenceToggle = {
    uses: (panelId) =>
      page.reference ? usesReference(referenceOptOut, projectId, panelId) : undefined,
    set: (panelId, use) => generation.setUseReference(projectId, panelId, use),
  }
  // ダイアログは先に閉じ、描いている間も編集できるようにする。終わればダウンロードが始まる
  const exportPng = async (opts: ExportOptions) => {
    setExporting('busy')
    try {
      const { settings, characters } = project
      const job = await collectExportJob(
        page,
        { settings, characters, loadAsset: library.loadAsset },
        opts,
      )
      downloadBlob(await pageExporter.exportPng(job), exportFileName(project.title, pageIndex))
    } catch (e) {
      toasts.push(`PNG の書き出しに失敗しました: ${errorMessage(e)}`)
    } finally {
      setExporting('closed')
    }
  }
  return (
    <section className={styles.editor}>
      <header className={styles.toolbar}>
        <Link to="/p/$projectId" params={{ projectId }} className={styles.back}>
          ← {project.title || '無題'}
        </Link>
        <span className={styles.pageNumber}>{pageIndex + 1} ページ</span>
        <CollaborationBar collab={collab} project={project} />
        {!canEdit && <span className={common.placeholder}>{ROLE_LABELS[role]}</span>}
        <SegmentedControl
          label="ツール"
          value={tool}
          options={tools}
          onChange={(t) => setTool(t)}
        />
        {tool === 'scribble' && (
          <SegmentedControl
            label="ペン"
            value={scribbleTool}
            options={SCRIBBLE_TOOLS}
            onChange={(t) => setScribbleTool(t)}
          />
        )}
        <ToolGroup label="レイヤー">
          {LAYERS.map((l) => (
            <Checkbox
              key={l.key}
              label={l.label}
              checked={layers[l.key]}
              onChange={(e) => setLayers({ ...layers, [l.key]: e.target.checked })}
            />
          ))}
        </ToolGroup>
        <span className={styles.actions}>
          <SaveStatusIndicator store={store} />
          <Button size="small" variant="ghost" disabled={!canUndo} onClick={() => store.undo()}>
            Undo
          </Button>
          <Button size="small" variant="ghost" disabled={!canRedo} onClick={() => store.redo()}>
            Redo
          </Button>
          <Button
            size="small"
            variant="primary"
            disabled={exporting === 'busy'}
            onClick={() => setExporting('dialog')}
          >
            {exporting === 'busy' ? '書き出し中…' : '書き出し'}
          </Button>
        </span>
      </header>
      {exporting === 'dialog' && (
        <ExportDialog
          onCancel={() => setExporting('closed')}
          onExport={(opts) => void exportPng(opts)}
        />
      )}
      {error && <p className={`${common.error} ${styles.error}`}>{error}</p>}
      <div className={styles.body}>
        <div
          className={styles.canvas}
          role="application"
          aria-label="キャンバス"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault()
          }}
          onDrop={(e) => {
            const file = firstFile(e.dataTransfer)
            if (!file) return
            e.preventDefault()
            importReference(file)
          }}
        >
          <EditorCanvas
            page={page}
            settings={project.settings}
            characters={project.characters}
            diagnosis={null}
            selection={selection}
            tool={tool}
            scribbleTool={scribbleTool}
            layers={layers}
            generating={generating}
            onChange={(patch) => apply('キャンバスの編集', (p) => pagePatch(p, pageId, patch))}
            onSelect={setSelection}
            onGenerate={generate}
            resolveAsset={resolveAsset}
          />
        </div>
        <aside className={styles.inspector}>
          <h2 className={styles.inspectorTitle}>インスペクタ</h2>
          <details open>
            <summary>要素（{page.panels.length}）</summary>
            <ElementOutline
              page={page}
              selection={selection}
              peers={peers.filter((peer) => peer.pageId === page.id)}
              onSelect={setSelection}
            />
          </details>
          <fieldset disabled={!canEdit} className={styles.inspectorFields}>
            <SelectionInspector
              page={page}
              pageId={pageId}
              characters={project.characters}
              selection={selection}
              generating={generating}
              apply={apply}
              generate={generate}
              referenceToggle={referenceToggle}
              resolveAsset={resolveAsset}
            />
            <details open={selection === null}>
              <summary>ページ</summary>
              <PageInspector
                page={page}
                generating={
                  pageBatch.running || page.panels.some((panel) => generating.has(panel.id))
                }
                onChange={(patch) => apply('ページを編集', (p) => pagePatch(p, pageId, patch))}
                onGenerateAll={pageBatch.start}
                onPickReference={referencePicker.open}
              />
              {referencePicker.input}
              <BatchOptions batch={pageBatch} />
            </details>
            <details>
              <summary>キャラクター（{project.characters.length}）</summary>
              {project.characters.length === 0 && (
                <p className={common.placeholder}>
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
          </fieldset>
        </aside>
      </div>
    </section>
  )
}

/** ページのコマとフキダシを読み順に並べたリスト。押すとキャンバスと同じ選択になり、他のクライアントが選んでいるものはその人のカーソル色で囲む */
function ElementOutline({
  page,
  selection,
  peers,
  onSelect,
}: {
  page: Page
  selection: Selection
  peers: Peer[]
  onSelect(sel: Selection): void
}) {
  const isSelected = (kind: 'panel' | 'bubble', id: ID) =>
    selection?.kind === kind && selection.id === id
  const peersOn = (id: ID) => peers.filter((peer) => peer.selection.includes(id))
  const peerProps = (by: Peer[]) => ({
    'data-peer-selected': by.length > 0,
    style: by[0] ? peerColor(by[0].color) : undefined,
  })
  const badges = (by: Peer[]) =>
    by.map((peer) => <PeerBadge key={peer.clientId} name={peer.name} color={peer.color} />)
  if (page.panels.length === 0) return <p className={common.placeholder}>コマがありません</p>
  return (
    <ul className={styles.outline}>
      {[...page.panels]
        .sort((a, b) => a.order - b.order)
        .map((panel) => {
          const by = peersOn(panel.id)
          return (
            <li key={panel.id}>
              <button
                type="button"
                aria-current={isSelected('panel', panel.id) || undefined}
                {...peerProps(by)}
                onClick={() => onSelect({ kind: 'panel', id: panel.id })}
              >
                コマ {panel.order}
                {panel.camera && ` [${panel.camera}]`}
              </button>
              {badges(by)}
              {panel.bubbles.length > 0 && (
                <ul>
                  {[...panel.bubbles]
                    .sort((a, b) => a.order - b.order)
                    .map((bubble) => {
                      const byBubble = peersOn(bubble.id)
                      return (
                        <li key={bubble.id}>
                          <button
                            type="button"
                            className={styles.ellipsis}
                            aria-current={isSelected('bubble', bubble.id) || undefined}
                            {...peerProps(byBubble)}
                            onClick={() => onSelect({ kind: 'bubble', id: bubble.id })}
                          >
                            フキダシ {bubble.order} {bubble.text || '（空）'}
                          </button>
                          {badges(byBubble)}
                        </li>
                      )
                    })}
                </ul>
              )}
            </li>
          )
        })}
    </ul>
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
  referenceToggle,
  resolveAsset,
}: {
  page: Page
  pageId: ID
  characters: Character[]
  selection: Selection
  generating: Set<ID>
  apply: Apply
  generate: Generate
  referenceToggle: ReferenceToggle
  resolveAsset(ref: string): Promise<string>
}) {
  if (selection === null) {
    return (
      <p className={common.placeholder}>キャンバスでコマかフキダシを選ぶと、ここで編集できます</p>
    )
  }
  if (selection.kind === 'panel') {
    const found = findPanel(page, selection.id)
    if (!found) return <p className={common.placeholder}>選んだコマはもうありません</p>
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
          useReference={referenceToggle.uses(selection.id)}
          onUseReferenceChange={(use) => referenceToggle.set(selection.id, use)}
          resolveAsset={resolveAsset}
        />
        <ArtRemoval panel={found.panel} pageId={pageId} apply={apply} />
      </>
    )
  }
  if (selection.kind === 'bubble') {
    const found = findBubble(page, selection.id)
    if (!found) return <p className={common.placeholder}>選んだフキダシはもうありません</p>
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
  return <p className={common.placeholder}>この要素の編集は未対応です</p>
}

/** 履歴の削除。採用中の絵は消せないので、それ以外だけ並べる。アセットは残し、Undo で戻せる */
function ArtRemoval({ panel, pageId, apply }: { panel: Panel; pageId: ID; apply: Apply }) {
  const removable = panel.arts.filter((art) => art.id !== panel.artId).reverse()
  if (removable.length === 0) return null
  return (
    <details className={styles.section} data-inspector="art-removal">
      <summary>履歴の削除（{removable.length}）</summary>
      <ul className={styles.artRemove}>
        {removable.map((art) => (
          <li key={art.id} data-art-id={art.id}>
            <span className={styles.ellipsis}>
              <time dateTime={art.createdAt}>{formatDate(art.createdAt)}</time>
              {art.instruction && ` ${art.instruction}`}
            </span>
            <Button
              size="small"
              variant="ghost"
              onClick={() => apply('絵を削除', (p) => removeArtPatch(p, pageId, panel.id, art.id))}
            >
              削除
            </Button>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** 非表示のファイル入力と、そのダイアログを開く関数。`input` は画面のどこかに置く */
function useFilePicker(accept: string, onPick: (file: File) => void) {
  const ref = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0]
        // 同じファイルを選び直しても change が出るように空にする
        e.target.value = ''
        if (file) onPick(file)
      }}
    />
  )
  return { open: () => ref.current?.click(), input }
}

/**
 * クリップボードのファイルを onFile に渡す。文字入力欄への貼り付けとファイルを含まない貼り付けには触らない
 */
function useReferencePaste(onFile: (file: File) => void) {
  const latest = useRef(onFile)
  latest.current = onFile
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      const file = firstFile(e.clipboardData)
      if (!file) return
      e.preventDefault()
      latest.current(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}

/** CharacterInspector に、参照画像を選ぶファイルダイアログと putAsset を付ける。読み込みはページの参考画像と同じ経路 */
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
  const [pickError, setPickError] = useState<string>()
  const picker = useFilePicker(REFERENCE_ACCEPT, (file) => {
    toReferenceImage(file)
      .then((blob) => library.putAsset(projectId, blob, `reference-${character.id}`))
      .then(
        (ref) => {
          setPickError(undefined)
          apply('参照画像を差し替え', (p) =>
            characterPatch(p, character.id, [{ op: 'add', path: '/referenceRef', value: ref }]),
          )
        },
        (err) => setPickError(errorMessage(err)),
      )
  })
  return (
    <>
      <CharacterInspector
        character={character}
        onChange={(patch) =>
          apply('キャラクターを編集', (p) => characterPatch(p, character.id, patch))
        }
        onPickReference={picker.open}
        resolveAsset={resolveAsset}
      />
      {pickError && (
        <p className={common.error} role="alert">
          {pickError}
        </p>
      )}
      {picker.input}
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
