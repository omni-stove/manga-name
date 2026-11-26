import { diagnosePage } from '@manga/diagnosis'
import {
  type CanvasMenuRequest,
  convertSketchPatch,
  copyElement,
  EditorCanvas,
  type FillTool,
  isLocked,
  type Layers,
  pastePatch,
  removePatch,
  type ScribbleTool,
  type Selection,
  type SketchTool,
  type Tool,
} from '@manga/editor-canvas'
import { m } from '@manga/i18n'
import {
  addCastPatch,
  BubbleInspector,
  FOCUS_KINDS,
  FocusInspector,
  IssueList,
  PageInspector,
  PageScriptInspector,
  PanelInspector,
  removeCastPatch,
  VectorInspector,
} from '@manga/inspector'
import {
  type Character,
  type Episode,
  type FocusKind,
  type ID,
  type Issue,
  type Page,
  type PageDiagnosis,
  type Patch,
  type Project,
  pageCharacterIds,
  pageSizeOf,
  pageTurns,
  panelCharacterIds,
  stripRuby,
} from '@manga/schema'
import { detectPlatform } from '@manga/storage'
import {
  Checkbox,
  ContextMenu,
  type ContextMenuItem,
  IconButton,
  RemoveButton,
  type SegmentedOption,
  Select,
  Sidebar,
  Typography,
  XStack,
  YStack,
} from '@manga/ui'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { type CSSProperties, useEffect, useEffectEvent, useState } from 'react'
import { useStore } from 'zustand'
import { BatchOptions, useBatchGeneration } from './batch-generation'
import {
  type ElementMenuContext,
  elementMenuItems,
  joinMenuItems,
  setLocked,
  shapeMenuItems,
  toolMenuItems,
} from './canvas-menu'
import { PeerBadge, peerColor, usePeers } from './collaboration-view'
import { previewPage } from './critique'
import { CritiquePanel } from './critique-panel'
import { chooseExportFolder, loadExportFolder, writePageFiles } from './desktop/export-folder'
import { receiveDroppedReference } from './dropped-reference'
import { Area, type EditorArea } from './editor-area'
import { EditorHeader, NEXT_PAGE_KEY, PREV_PAGE_KEY } from './editor-header'
import {
  type ClipboardElement,
  parseElement,
  serializeElement,
  useElementClipboard,
} from './element-clipboard'
import { ExportDialog, type ExportSettings } from './export-dialog'
import { exportFileName, pageExporter } from './export-page'
import { collectExportJob } from './export-page-job'
import { REFERENCE_ACCEPT, useFilePicker } from './file-picker'
import {
  generatingPage,
  generatingPanels,
  type PanelGeneration,
  usesHint,
  usesReference,
} from './generate-panel'
import { MOD } from './history-buttons'
import {
  bubblePatch,
  findBubble,
  findFocus,
  findPanel,
  findVector,
  focusPatch,
  panelPatch,
  removeArtPatch,
  vectorPatch,
} from './inspector-ops'
import { LayoutSuggestions } from './layout-suggestions'
import { AddPageDialog, LayoutTemplateDialog } from './layout-templates'
import type { LlmProvider } from './llm-provider'
import styles from './page-editor.module.css'
import {
  exportProjectJson,
  PROJECT_FILE_FILTERS,
  exportFileName as projectFileName,
} from './project-file'
import type { Collaboration, ProjectLibrary } from './project-library'
import { findPage, pagePatch } from './project-ops'
import { firstFile, referencePatch, toReferenceImage } from './reference-image'
import { errorMessage } from './route-error'
import { saveFile } from './save-file'
import { ROLE_LABELS } from './sharing'
import type { Peer } from './store/presence'
import type { WebProjectStore } from './store/project-store-types'
import { toasts } from './toasts'
import { useAssetResolver } from './use-asset-resolver'
import { useKeyShortcuts } from './use-key-shortcuts'
import { useApplyPatch, useProject } from './use-project'
import { useStoredFlag, useStoredWidth } from './use-stored-flag'
import { useTypefaceFonts } from './use-typeface-fonts'
import { useUndoShortcuts } from './use-undo-shortcuts'

// 数字キーはペンと焦点の種別に使うので、ツールは英字にする
const toolOptions = (): readonly SegmentedOption<Tool>[] => [
  { value: 'select', label: m.web_editor_tool_select(), shortcut: 'v' },
  { value: 'panel', label: m.panel(), shortcut: 'p' },
  { value: 'bubble', label: m.bubble(), shortcut: 'b' },
  { value: 'focus', label: m.focus_point(), shortcut: 'f' },
  { value: 'vector', label: m.vector(), shortcut: 'a' },
  { value: 'scribble', label: m.page_scribbles(), shortcut: 'd' },
  { value: 'sketch', label: m.page_sketch(), shortcut: 'n' },
  { value: 'fill', label: m.page_fills(), shortcut: 'g' },
]

const scribbleToolOptions = (): readonly SegmentedOption<ScribbleTool>[] => [
  { value: 'ink', label: m.stroke_color_ink(), shortcut: '1' },
  { value: 'red', label: m.stroke_color_red(), shortcut: '2' },
  { value: 'blue', label: m.stroke_color_blue(), shortcut: '3' },
  { value: 'eraser', label: m.web_editor_pen_eraser(), shortcut: '4' },
]

const sketchToolOptions = (): readonly SegmentedOption<SketchTool>[] => [
  { value: 'pen', label: m.web_editor_sketch_pen(), shortcut: '1' },
  { value: 'eraser', label: m.web_editor_pen_eraser(), shortcut: '2' },
]

const fillToolOptions = (): readonly SegmentedOption<FillTool>[] => [
  { value: 'black', label: m.fill_color_black(), shortcut: '1' },
  { value: 'gray', label: m.fill_color_gray(), shortcut: '2' },
]

const focusKindOptions = (): readonly SegmentedOption<FocusKind>[] =>
  FOCUS_KINDS.map((k, i) => ({ value: k.value, label: k.label, shortcut: String(i + 1) }))

/** 選択肢のキーから、その値を選ぶ操作への対応を作る */
function shortcutsOf<T extends string>(
  options: readonly SegmentedOption<T>[],
  select: (value: T) => void,
): Record<string, () => void> {
  return Object.fromEntries(
    options.flatMap((o) => (o.shortcut ? [[o.shortcut, () => select(o.value)]] : [])),
  )
}

// 診断の経路はコマ単位の centre sweep で、読者の目が実際に追うコマ内の顔などを見ていないので、
// 読み順 OK や miss は評価として当てにならない。LLM に評価させるのも費用に見合わない。
// そのため診断レイヤー、読み順と焦点の集計、経路に基づく診断の問題、AI に相談を出さない。生成プロンプトのヒントは残す
const GAZE_EVALUATION = false

// セリフの字数・コマ数・寄りの並びは診断の経路を使わずに数えるので、GAZE_EVALUATION が無くても一覧に出す
const PATHLESS_ISSUES: ReadonlySet<Issue['code']> = new Set([
  'TOO_MUCH_TEXT',
  'PANEL_COUNT',
  'MONOTONOUS_CAMERA',
])

/** 診断の一覧に出す Issue */
const shownIssues = (issues: readonly Issue[]): readonly Issue[] =>
  GAZE_EVALUATION ? issues : issues.filter((issue) => PATHLESS_ISSUES.has(issue.code))

const layerOptions = (): readonly { key: keyof Layers; label: string }[] => [
  { key: 'reference', label: m.web_editor_layer_reference() },
  { key: 'art', label: m.web_editor_layer_art() },
  { key: 'scribble', label: m.page_scribbles() },
  { key: 'sketch', label: m.page_sketch() },
  { key: 'hints', label: m.web_editor_layer_hints() },
  { key: 'frames', label: m.web_editor_layer_frames() },
  ...(GAZE_EVALUATION
    ? [{ key: 'diagnosis' as const, label: m.web_editor_layer_diagnosis() }]
    : []),
]

const ALL_LAYERS: Layers = {
  reference: true,
  art: true,
  scribble: true,
  sketch: true,
  hints: true,
  diagnosis: GAZE_EVALUATION,
  frames: true,
}

export interface PageEditorProps {
  projectId: ID
  pageId: ID
  store: WebProjectStore
  collab: Collaboration | undefined
  library: ProjectLibrary
  generation: PanelGeneration
  llmProvider: LlmProvider
  /** 使える領域。省略すると全部使える */
  unlocked?: ReadonlySet<EditorArea>
  /** レイヤーの表示を切り替えた */
  onLayersChange?: (layers: Layers) => void
  /** ページを書き出して保存した */
  onExport?: () => void
}

type Apply = (label: string, build: (project: Project) => Patch) => boolean
type Generate = (panelId: ID, instruction?: string) => void
/** コマの「参考画像を使う」。ページに参考画像が無ければ undefined */
interface ReferenceToggle {
  uses(panelId: ID): boolean | undefined
  set(panelId: ID, use: boolean): void
}
/** コマの「ヒントを使う」 */
interface HintToggle {
  uses(panelId: ID): boolean
  set(panelId: ID, use: boolean): void
}

/**
 * 開いている右クリックメニュー。`sub` はフキダシのメニューから切り替えたあとのメニューで、
 * shapes は形を選ぶメニュー、joins はつなぐ相手を選ぶメニュー
 */
type OpenMenu = CanvasMenuRequest & { sub?: 'shapes' | 'joins' }

const MENU_LABELS: Record<NonNullable<Selection>['kind'], () => string> = {
  panel: m.web_editor_menu_panel,
  bubble: m.web_editor_menu_bubble,
  focus: m.web_editor_menu_focus,
  vector: m.web_editor_menu_vector,
}

/** 要素 root の Patch を Project root に */
function elementPatch(
  project: Project,
  pageId: ID,
  target: NonNullable<Selection>,
  patch: Patch,
): Patch {
  if (target.kind === 'panel') return panelPatch(project, pageId, target.id, patch)
  if (target.kind === 'bubble') return bubblePatch(project, pageId, target.id, patch)
  if (target.kind === 'focus') return focusPatch(project, pageId, target.id, patch)
  return vectorPatch(project, pageId, target.id, patch)
}

/** 書き出しダイアログが開いているか。`{ done, total }` は書き出し中で、描き終えたページ数と対象のページ数 */
type Exporting = 'closed' | 'dialog' | { done: number; total: number }

const MM_PER_INCH = 25.4

/** 選択が指す要素がまだページにあるか。Delete や Undo で消えた要素の選択は無いものとして扱う */
function hasElement(page: Page, selection: Selection): boolean {
  if (selection === null) return false
  if (selection.kind === 'panel') return findPanel(page, selection.id) !== undefined
  if (selection.kind === 'bubble') return findBubble(page, selection.id) !== undefined
  if (selection.kind === 'focus') return findFocus(page, selection.id) !== undefined
  return findVector(page, selection.id) !== undefined
}

/** 選択要素のコマ。コマならそれ自身 */
function panelOf(page: Page, selection: Selection): ID | undefined {
  if (selection === null) return undefined
  if (selection.kind === 'panel') return findPanel(page, selection.id)?.panel.id
  if (selection.kind === 'bubble') return findBubble(page, selection.id)?.panel.id
  if (selection.kind === 'focus') return findFocus(page, selection.id)?.panel.id
  return findVector(page, selection.id)?.panel.id
}

/** Issue が指す要素。焦点の id はフキダシの合成焦点ならフキダシを指す */
function issueTarget(page: Page, issue: Issue): Selection {
  const id = issue.focusPointId
  if (id !== undefined) {
    if (findFocus(page, id)) return { kind: 'focus', id }
    if (findBubble(page, id)) return { kind: 'bubble', id }
  }
  if (issue.panelId !== undefined && findPanel(page, issue.panelId)) {
    return { kind: 'panel', id: issue.panelId }
  }
  return null
}

/**
 * キャンバスの枠に渡す、ページ（見開きなら 2 ページ分）の縦横比。
 * 狭い画面ではキャンバスの高さを画面から決められないので、この比で幅から高さを決める
 */
function pageAspectStyle(size: { w: number; h: number }): CSSProperties {
  return { '--page-aspect': `${size.w} / ${size.h}` } as CSSProperties
}

/**
 * ページの編集画面。ツールバー、左にページの脚本とコマ割りの提案、キャンバス、右にインスペクタ。
 * `unlocked` を渡すと、そこに無い領域をキーボードでも操作できなくする
 */
export function PageEditor({
  projectId,
  pageId,
  store,
  collab,
  library,
  generation,
  llmProvider,
  unlocked,
  onLayersChange,
  onExport,
}: PageEditorProps) {
  const can = (area: EditorArea) => unlocked?.has(area) ?? true
  // 案内が「このページを全部生成」を指す間は、ボタンが畳んだサイドバーや閉じたページの欄に隠れないよう開いておく
  const guidingGenerate = unlocked?.has('generate') === true
  const project = useProject(store)
  const generatingState = useStore(generation.generating)
  const generating = generatingPanels(generatingState, projectId)
  const referenceOptOut = useStore(generation.referenceOptOut)
  const hintOptOut = useStore(generation.hintOptOut)
  const { apply, error } = useApplyPatch(store)
  const resolveAsset = useAssetResolver(library.resolveAsset)
  const peers = usePeers(collab)
  const role = library.role(projectId) ?? 'owner'
  const canEdit = role === 'owner' || role === 'editor'
  // commenter は手描きメモだけ書けるので、選択と手描き以外のツールを出さない
  const tools = canEdit
    ? toolOptions()
    : toolOptions().filter(
        (t) => t.value === 'select' || (role === 'commenter' && t.value === 'scribble'),
      )
  const [tool, setTool] = useState<Tool>('select')
  const [scribbleTool, setScribbleTool] = useState<ScribbleTool>('ink')
  const [sketchTool, setSketchTool] = useState<SketchTool>('pen')
  const [fillTool, setFillTool] = useState<FillTool>('black')
  const [focusKind, setFocusKind] = useState<FocusKind>('face')
  const [layers, setLayers] = useState<Layers>(ALL_LAYERS)
  const [selected, setSelection] = useState<Selection>(null)
  const [exporting, setExporting] = useState<Exporting>('closed')
  const desktop = detectPlatform() === 'desktop'
  // 読み込みを待つ間に別のプロジェクトへ移っても前のプロジェクトのフォルダへ書かないよう、どのプロジェクトのものかを持つ
  const [loadedFolder, setLoadedFolder] = useState<{ projectId: ID; path: string | null }>()
  /** Desktop でこのプロジェクトの書き出し先として覚えているフォルダ。選んだことが無ければ null */
  const exportFolder = loadedFolder?.projectId === projectId ? loadedFolder.path : null
  const [inspectorExpanded, setInspectorExpanded] = useStoredFlag('manga.inspector.expanded', true)
  const [scriptExpanded, setScriptExpanded] = useStoredFlag('manga.script.expanded', true)
  const [inspectorWidth, setInspectorWidth] = useStoredWidth('manga.inspector.width')
  const [scriptWidth, setScriptWidth] = useStoredWidth('manga.script.width')
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  // 描いている途中でページを移ったら、移った先のコマに頂点を置かないよう、どのページのコマかを持つ
  const [breakoutFor, setBreakoutFor] = useState<{ pageId: ID; panelId: ID } | null>(null)
  const breakoutPanelId = breakoutFor?.pageId === pageId ? breakoutFor.panelId : null
  const [registeringLayout, setRegisteringLayout] = useState(false)
  const [addingPage, setAddingPage] = useState(false)
  const canUndo = useStore(store.state, (s) => s.canUndo)
  const canRedo = useStore(store.state, (s) => s.canRedo)
  useUndoShortcuts(store, can('history'))
  const navigate = useNavigate()
  const scribbleTools = scribbleToolOptions()
  const sketchTools = sketchToolOptions()
  const fillTools = fillToolOptions()
  const importReference = (file: Blob) => {
    toReferenceImage(file)
      .then((blob) => library.putAsset(projectId, blob, `reference-${pageId}`))
      .then(
        (ref) =>
          apply(m.web_editor_history_import_reference(), (p) => {
            const current = findPage(p, pageId)
            if (!current) throw new Error(m.web_common_page_gone())
            return pagePatch(p, pageId, referencePatch(current.page, ref))
          }),
        (err) => toasts.push(m.web_editor_reference_import_failed({ reason: errorMessage(err) })),
      )
  }
  useReferencePaste(importReference, can('canvas'))
  useDroppedReference(importReference, can('canvas'))
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
  const foundPage = found?.page
  useTypefaceFonts(foundPage)
  const diagnosis = foundPage ? diagnosePage(foundPage, project.settings) : null
  const issues = diagnosis ? shownIssues(diagnosis.issues) : []
  // 提案の Patch だけを持ち、ゴーストは今のページに当てて作る。ホバー中に編集されても古いページを描かない
  const [preview, setPreview] = useState<Patch | null>(null)
  const ghostPage = foundPage && preview ? previewPage(foundPage, preview) : undefined

  const episodePages = found ? project.episodes[found.episodeIndex]?.pages : undefined
  const prevPage = found ? episodePages?.[found.pageIndex - 1] : undefined
  const nextPage = found ? episodePages?.[found.pageIndex + 1] : undefined
  const openPage = (id: ID) =>
    void navigate({ to: '/p/$projectId/pages/$pageId', params: { projectId, pageId: id } })
  useKeyShortcuts({
    ...(can('tools') ? shortcutsOf(tools, setTool) : {}),
    ...(tool === 'scribble' ? shortcutsOf(scribbleTools, setScribbleTool) : {}),
    ...(tool === 'sketch' ? shortcutsOf(sketchTools, setSketchTool) : {}),
    ...(tool === 'fill' ? shortcutsOf(fillTools, setFillTool) : {}),
    ...(tool === 'focus' ? shortcutsOf(focusKindOptions(), setFocusKind) : {}),
    ...(can('navigation')
      ? {
          [PREV_PAGE_KEY]: () => prevPage && openPage(prevPage.id),
          [NEXT_PAGE_KEY]: () => nextPage && openPage(nextPage.id),
        }
      : {}),
  })
  const copySelection = (): ClipboardElement | null => {
    const element = foundPage ? copyElement(foundPage, selected) : null
    return element && { projectId, element }
  }
  const pasteElement = (clip: ClipboardElement) => {
    let pasted: Selection = null
    const applied = apply(m.web_editor_history_paste_element(), (p) => {
      const current = findPage(p, pageId)
      if (!current) throw new Error(m.web_common_page_gone())
      const result = pastePatch(current.page, clip.element, {
        panelId: panelOf(current.page, selected),
        sameProject: clip.projectId === projectId,
        pageSize: pageSizeOf(current.page, p.settings.pageSize),
      })
      if (!result) throw new Error(m.web_editor_paste_no_panel())
      pasted = result.selection
      return pagePatch(p, pageId, result.patch)
    })
    if (applied) setSelection(pasted)
  }
  useElementClipboard({
    copy: copySelection,
    paste: canEdit ? pasteElement : undefined,
    enabled: can('canvas'),
  })

  useEffect(() => {
    collab?.presence.setLocation({ pageId, selection: selectedId ? [selectedId] : [] })
  }, [collab, pageId, selectedId])
  useEffect(() => () => collab?.presence.setLocation({ pageId: null, selection: [] }), [collab])
  useEffect(() => {
    if (!desktop) return
    loadExportFolder(projectId).then(
      (path) => setLoadedFolder({ projectId, path }),
      (e: unknown) => toasts.push(m.web_export_folder_failed({ reason: errorMessage(e) })),
    )
  }, [desktop, projectId])

  // 開いている間に Undo や別タブの操作でページが消えることがある
  if (!found) return <PageNotFound />
  const { page, pageIndex, episodeIndex } = found
  const episode = project.episodes[episodeIndex] as Episode
  const selection = hasElement(page, selected) ? selected : null
  // 結果は generation がトーストと Patch で出すので、ここでは待たない
  const generate: Generate = (panelId, instruction) =>
    void generation.generate({ store, projectId, pageId, panelId, instruction })
  const referenceToggle: ReferenceToggle = {
    uses: (panelId) =>
      page.reference ? usesReference(referenceOptOut, projectId, panelId) : undefined,
    set: (panelId, use) => generation.setUseReference(projectId, panelId, use),
  }
  const hintToggle: HintToggle = {
    uses: (panelId) => usesHint(hintOptOut, projectId, panelId),
    set: (panelId, use) => generation.setUseHint(projectId, panelId, use),
  }
  // ダイアログは先に閉じ、描いている間も編集できるようにする。終わればダウンロードか保存先の選択が始まる
  const exportPages = async ({ format, from, to, dpi, toFolder, ...opts }: ExportSettings) => {
    const total = to - from + 1
    const numbers = Array.from({ length: total }, (_, i) => from + i)
    const ext = format === 'pdf' ? 'pdf' : total === 1 ? 'png' : 'zip'
    const width = Math.round((project.settings.pageSize.w / MM_PER_INCH) * dpi)
    const onProgress = (done: number) => setExporting({ done, total })
    const render = async (pageIds: ID[], progress?: (done: number) => void) =>
      pageExporter.run(
        await collectExportJob(
          project,
          episode.id,
          pageIds,
          format,
          { ...opts, width },
          library.loadAsset,
        ),
        progress,
      )
    const saveToFile = async () =>
      saveFile(
        await render(
          episode.pages.slice(from - 1, to).map((p) => p.id),
          onProgress,
        ),
        exportFileName(project.title, numbers, ext),
        [{ name: ext.toUpperCase(), extensions: [ext] }],
      )
    const saveToFolder = async (folder: string) => {
      await writePageFiles(
        folder,
        numbers,
        (number) => render(episode.pages.slice(number - 1, number).map((p) => p.id)),
        onProgress,
      )
      return folder
    }
    const folder = toFolder ? exportFolder : null
    const write = folder ? () => saveToFolder(folder) : saveToFile
    setExporting({ done: 0, total })
    /** 保存したパス。書き出せなければ undefined */
    let path: string | null | undefined
    try {
      path = await write()
    } catch (e) {
      toasts.push(m.web_page_export_failed({ reason: errorMessage(e) }))
    }
    setExporting('closed')
    // React Compiler は try の中の条件式を扱えないので、書き出し先は try の前に選び、結果は try を出てから見る。
    // Web は常に null を返すので、保存先の選択を閉じたかどうかは Desktop でだけ分かる
    if (path !== undefined && (path !== null || detectPlatform() === 'web')) onExport?.()
  }
  const convertSketch = () => {
    let converted = { panels: 0, bubbles: 0 }
    const applied = apply(m.web_editor_history_convert_sketch(), (p) => {
      const current = findPage(p, pageId)
      if (!current) throw new Error(m.web_common_page_gone())
      const { patch, ...counts } = convertSketchPatch(
        current.page,
        pageSizeOf(current.page, p.settings.pageSize),
        p.settings.direction,
      )
      // 何も変えない変換を Undo の履歴に積まない
      if (patch.length === 0) throw new Error(m.web_editor_sketch_nothing())
      converted = counts
      return pagePatch(p, pageId, patch)
    })
    if (applied) toasts.push(m.web_editor_sketch_converted(converted))
  }
  const undoItems: ContextMenuItem[] = [
    {
      label: m.web_history_undo(),
      shortcut: `${MOD}Z`,
      disabled: !canUndo,
      onSelect: () => store.undo(),
    },
    {
      label: m.web_history_redo(),
      shortcut: `${MOD}Shift+Z`,
      disabled: !canRedo,
      onSelect: () => store.redo(),
    },
  ]
  const clipboardFailed = (e: unknown) =>
    toasts.push(m.web_editor_clipboard_failed({ reason: errorMessage(e) }))
  // メニューからは copy と paste のイベントを出せないので、Clipboard API で読み書きする
  const copyItem = (target: NonNullable<Selection>): ContextMenuItem => ({
    label: m.copy(),
    shortcut: `${MOD}C`,
    onSelect: () => {
      const element = copyElement(page, target)
      if (!element) return
      navigator.clipboard.writeText(serializeElement({ projectId, element })).catch(clipboardFailed)
    },
  })
  const pasteItems: ContextMenuItem[] = canEdit
    ? [
        {
          label: m.paste(),
          shortcut: `${MOD}V`,
          onSelect: () =>
            void navigator.clipboard.readText().then((text) => {
              const clip = parseElement(text)
              if (clip) pasteElement(clip)
              else toasts.push(m.web_editor_paste_nothing())
            }, clipboardFailed),
        },
      ]
    : []
  const pageMenuItems: (ContextMenuItem | 'separator')[] = [
    ...undoItems,
    ...pasteItems,
    'separator',
    { label: m.web_editor_menu_fit(), onSelect: () => menu?.fit() },
    ...(canEdit
      ? [
          { label: m.web_editor_menu_import_reference(), onSelect: referencePicker.open },
          {
            label: m.web_editor_menu_register_layout(),
            disabled: page.panels.length === 0,
            onSelect: () => setRegisteringLayout(true),
          },
        ]
      : []),
    ...(tools.length > 1 ? ['separator' as const, ...toolMenuItems(tools, tool, setTool)] : []),
    'separator',
    {
      label: m.web_editor_prev_page(),
      shortcut: PREV_PAGE_KEY,
      disabled: !prevPage,
      onSelect: () => prevPage && openPage(prevPage.id),
    },
    {
      label: m.web_editor_next_page(),
      shortcut: NEXT_PAGE_KEY,
      disabled: !nextPage,
      onSelect: () => nextPage && openPage(nextPage.id),
    },
  ]
  // 編集できない人には要素への操作が無いので、要素の上でもページのメニューを出す
  const menuTarget = canEdit && menu?.target && hasElement(page, menu.target) ? menu.target : null
  const menuContext = {
    page,
    settings: project.settings,
    tools,
    tool,
    edit: (label: string, target: NonNullable<Selection>, patch: Patch) =>
      apply(label, (p) => elementPatch(p, pageId, target, patch)),
    editPage: (label: string, build: (page: Page) => Patch) =>
      apply(label, (p) => {
        const current = findPage(p, pageId)
        if (!current) throw new Error(m.web_common_page_gone())
        return pagePatch(p, pageId, build(current.page))
      }),
    remove: (target: NonNullable<Selection>) => {
      const removed = apply(m.web_editor_history_remove_element(), (p) => {
        const current = findPage(p, pageId)
        if (!current) throw new Error(m.web_common_page_gone())
        return pagePatch(p, pageId, removePatch(current.page, target))
      })
      if (removed) setSelection(null)
    },
    setTool,
    openShapes: () => menu && setMenu({ ...menu, sub: 'shapes' }),
    openJoins: () => menu && setMenu({ ...menu, sub: 'joins' }),
    drawBreakout: (panelId: ID) => setBreakoutFor({ pageId, panelId }),
  }
  const subOf =
    menuTarget?.kind === 'bubble' && menu?.sub
      ? { sub: menu.sub, found: findBubble(page, menuTarget.id) }
      : undefined
  const shapesOf = subOf?.sub === 'shapes' ? subOf.found : undefined
  const joinsOf = subOf?.sub === 'joins' ? subOf.found : undefined
  const openMenu = menu && {
    label: shapesOf
      ? m.web_editor_menu_bubble_shapes()
      : joinsOf
        ? m.web_editor_menu_bubble_joins()
        : menuTarget
          ? MENU_LABELS[menuTarget.kind]()
          : m.web_editor_page_menu(),
    items: shapesOf
      ? shapeMenuItems(shapesOf.bubble, menuContext)
      : joinsOf
        ? joinMenuItems(joinsOf.bubble, menuContext)
        : menuTarget
          ? [
              ...elementMenuItems(menuTarget, menuContext),
              'separator' as const,
              copyItem(menuTarget),
              ...pasteItems,
              'separator' as const,
              ...undoItems,
            ]
          : pageMenuItems,
  }
  const chooseFolder = () => {
    chooseExportFolder(projectId, exportFolder).then(
      (path) => {
        if (path !== null) setLoadedFolder({ projectId, path })
      },
      (e: unknown) => toasts.push(m.web_export_folder_failed({ reason: errorMessage(e) })),
    )
  }
  const exportProject = () => {
    setExporting('closed')
    saveFile(
      new Blob([exportProjectJson(project)], { type: 'application/json' }),
      projectFileName(project),
      PROJECT_FILE_FILTERS,
    ).catch((e: unknown) => toasts.push(m.web_project_export_failed({ reason: errorMessage(e) })))
  }
  return (
    <YStack as="section" gap={0} className={styles.editor}>
      <EditorHeader
        projectId={projectId}
        project={project}
        episode={episode}
        pageId={pageId}
        prevPageId={prevPage?.id}
        nextPageId={nextPage?.id}
        onOpenPage={openPage}
        onAddPage={canEdit ? () => setAddingPage(true) : undefined}
        collab={collab}
        roleLabel={canEdit ? undefined : ROLE_LABELS[role]}
        store={store}
        can={can}
        tool={{ options: tools, value: tool, onChange: setTool }}
        scribbleTool={{ options: scribbleTools, value: scribbleTool, onChange: setScribbleTool }}
        sketchTool={{ options: sketchTools, value: sketchTool, onChange: setSketchTool }}
        fillTool={{ options: fillTools, value: fillTool, onChange: setFillTool }}
        focusKind={{ options: focusKindOptions(), value: focusKind, onChange: setFocusKind }}
        onConvertSketch={page.sketch?.length ? convertSketch : undefined}
        layerOptions={layerOptions()}
        layers={layers}
        onLayersChange={(next) => {
          setLayers(next)
          onLayersChange?.(next)
        }}
        exportProgress={typeof exporting === 'object' ? exporting : undefined}
        onExport={() => setExporting('dialog')}
      />
      {menu && openMenu && (
        <ContextMenu
          // 形のメニューに切り替えたら付け直し、最初の項目にフォーカスを移す
          key={openMenu.label}
          label={openMenu.label}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={openMenu.items}
        />
      )}
      {addingPage && (
        <AddPageDialog
          project={project}
          episodeId={episode.id}
          apply={apply}
          onAdded={(id) => {
            setAddingPage(false)
            openPage(id)
          }}
          onClose={() => setAddingPage(false)}
        />
      )}
      {registeringLayout && (
        <LayoutTemplateDialog
          pageId={pageId}
          apply={apply}
          onClose={() => setRegisteringLayout(false)}
        />
      )}
      {exporting === 'dialog' && (
        <ExportDialog
          pages={episode.pages}
          currentIndex={pageIndex}
          dpi={project.settings.dpi}
          folder={desktop ? { path: exportFolder, onChoose: chooseFolder } : undefined}
          onCancel={() => setExporting('closed')}
          onExport={(settings) => void exportPages(settings)}
          onExportProject={exportProject}
        />
      )}
      {error && (
        <Typography tone="alert" className={styles.error}>
          {error}
        </Typography>
      )}
      <div className={styles.body}>
        <Sidebar
          title={m.page_script()}
          side="left"
          expanded={scriptExpanded}
          onExpandedChange={setScriptExpanded}
          width={scriptWidth}
          onWidthChange={setScriptWidth}
          className={styles.scriptSidebar}
        >
          <Area open={can('inspector')}>
            {/* 入力の待ち（useDraft）が移った先のページへ書き込まないよう、ページごとに作り直す */}
            <PageScriptInspector
              key={`script-${pageId}`}
              page={page}
              editable={canEdit}
              onChange={(patch) =>
                apply(m.web_editor_history_edit_page_script(), (p) => pagePatch(p, pageId, patch))
              }
            />
            <LayoutSuggestions
              key={pageId}
              store={store}
              project={project}
              page={page}
              pageId={pageId}
              llmProvider={llmProvider}
              canEdit={canEdit}
            />
          </Area>
        </Sidebar>
        <div
          className={styles.canvas}
          role="application"
          aria-label={m.web_editor_canvas()}
          data-area="canvas"
          style={pageAspectStyle(pageSizeOf(page, project.settings.pageSize))}
          inert={!can('canvas')}
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
            diagnosis={diagnosis}
            ghostPage={ghostPage}
            turn={pageTurns(episode, project.settings.direction).get(page.id)}
            selection={selection}
            tool={tool}
            scribbleTool={scribbleTool}
            sketchTool={sketchTool}
            fillTool={fillTool}
            focusKind={focusKind}
            layers={layers}
            generating={generating}
            generatingPage={generatingPage(generatingState, projectId, pageId)}
            onChange={(patch) =>
              apply(m.web_editor_history_edit_canvas(), (p) => pagePatch(p, pageId, patch))
            }
            onSelect={setSelection}
            onGenerate={generate}
            resolveAsset={resolveAsset}
            onContextMenu={can('canvas') ? setMenu : undefined}
            breakoutPanelId={canEdit ? breakoutPanelId : null}
            onBreakoutEnd={() => setBreakoutFor(null)}
          />
        </div>
        <Sidebar
          title={m.web_editor_inspector()}
          side="right"
          expanded={inspectorExpanded || guidingGenerate}
          onExpandedChange={setInspectorExpanded}
          width={inspectorWidth}
          onWidthChange={setInspectorWidth}
          className={styles.inspectorSidebar}
        >
          <div className={styles.inspector}>
            <details open>
              <summary>{m.web_editor_elements({ count: page.panels.length })}</summary>
              <Area open={can('inspector')}>
                <ElementOutline
                  page={page}
                  selection={selection}
                  peers={peers.filter((peer) => peer.pageId === page.id)}
                  onSelect={setSelection}
                />
              </Area>
            </details>
            <fieldset disabled={!canEdit} className={styles.inspectorFields}>
              <Area open={can('inspector')}>
                {selection && (
                  <ElementActions page={page} target={selection} actions={menuContext} />
                )}
                <SelectionInspector
                  page={page}
                  pageId={pageId}
                  characters={project.characters}
                  diagnosis={diagnosis}
                  selection={selection}
                  generating={generating}
                  apply={apply}
                  generate={generate}
                  referenceToggle={referenceToggle}
                  hintToggle={hintToggle}
                  resolveAsset={resolveAsset}
                />
              </Area>
              <details open={selection === null || guidingGenerate}>
                <summary>{m.page()}</summary>
                <PageInspector
                  key={pageId}
                  page={page}
                  diagnosis={GAZE_EVALUATION ? (diagnosis ?? undefined) : undefined}
                  generating={
                    pageBatch.running || page.panels.some((panel) => generating.has(panel.id))
                  }
                  onChange={(patch) =>
                    apply(m.web_editor_history_edit_page(), (p) => pagePatch(p, pageId, patch))
                  }
                  editable={can('inspector')}
                  onGenerateAll={can('generate') ? pageBatch.start : undefined}
                  onPickReference={referencePicker.open}
                />
                {referencePicker.input}
                <Area open={can('generate')}>
                  <BatchOptions batch={pageBatch} />
                </Area>
              </details>
              <Area open={can('inspector')}>
                <PageCast
                  page={page}
                  characters={project.characters}
                  projectId={projectId}
                  onChange={(patch) =>
                    apply(m.web_editor_history_change_page_cast(), (p) =>
                      pagePatch(p, pageId, patch),
                    )
                  }
                />
              </Area>
            </fieldset>
            {diagnosis && (
              <details open data-section="issues">
                <summary>{m.web_editor_diagnosis_issues({ count: issues.length })}</summary>
                <IssueList
                  issues={issues}
                  onFocus={(issue) => {
                    const target = issueTarget(page, issue)
                    if (target) setSelection(target)
                  }}
                />
                {GAZE_EVALUATION && (
                  <CritiquePanel
                    key={pageId}
                    store={store}
                    page={page}
                    pageId={pageId}
                    pageSize={pageSizeOf(page, project.settings.pageSize)}
                    diagnosis={diagnosis}
                    llmProvider={llmProvider}
                    canEdit={canEdit}
                    generating={generating}
                    onPreview={setPreview}
                    onGenerate={generate}
                  />
                )}
              </details>
            )}
          </div>
        </Sidebar>
      </div>
    </YStack>
  )
}

/**
 * 選んでいる要素の位置のロックと削除。右クリックメニューと同じ操作で、
 * 長押しに気づかないタッチ端末や、キーボードの無い iPad でも押せるよう常に出しておく
 */
function ElementActions({
  page,
  target,
  actions,
}: {
  page: Page
  target: NonNullable<Selection>
  actions: Pick<ElementMenuContext, 'edit' | 'remove'>
}) {
  return (
    <XStack justify="between" data-section="element-actions">
      <Checkbox
        label={m.web_canvas_menu_lock()}
        checked={isLocked(page, target)}
        onChange={(e) => setLocked(actions, target, e.target.checked)}
      />
      <RemoveButton size="small" label={m.remove()} onClick={() => actions.remove(target)} />
    </XStack>
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
  if (page.panels.length === 0)
    return <Typography tone="muted">{m.web_editor_no_panels()}</Typography>
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
                {m.web_editor_outline_panel({ order: panel.order })}
                {panel.camera && ` [${m[`panel_camera_${panel.camera}` as const]()}]`}
                {panel.angle && ` [${m[`panel_angle_${panel.angle}` as const]()}]`}
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
                            {m.web_editor_outline_bubble({
                              order: bubble.order,
                              text: stripRuby(bubble.text) || m.empty(),
                            })}
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
  diagnosis,
  selection,
  generating,
  apply,
  generate,
  referenceToggle,
  hintToggle,
  resolveAsset,
}: {
  page: Page
  pageId: ID
  characters: Character[]
  diagnosis: PageDiagnosis | null
  selection: Selection
  generating: Set<ID>
  apply: Apply
  generate: Generate
  referenceToggle: ReferenceToggle
  hintToggle: HintToggle
  resolveAsset(ref: string): Promise<string>
}) {
  if (selection === null) {
    return <Typography tone="muted">{m.web_editor_selection_hint()}</Typography>
  }
  if (selection.kind === 'panel') {
    const found = findPanel(page, selection.id)
    if (!found) return <Typography tone="muted">{m.web_editor_panel_gone()}</Typography>
    return (
      <PanelInspector
        key={selection.id}
        panel={found.panel}
        characters={characters}
        diagnosis={diagnosis?.panels.find((d) => d.panelId === selection.id)}
        generating={generating.has(selection.id)}
        onChange={(patch) =>
          apply(m.web_editor_history_edit_panel(), (p) =>
            panelPatch(p, pageId, selection.id, patch),
          )
        }
        onGenerate={(instruction) => generate(selection.id, instruction)}
        useReference={referenceToggle.uses(selection.id)}
        onUseReferenceChange={(use) => referenceToggle.set(selection.id, use)}
        useHint={hintToggle.uses(selection.id)}
        onUseHintChange={(use) => hintToggle.set(selection.id, use)}
        onRemoveArt={(artId) =>
          apply(m.web_editor_history_remove_art(), (p) =>
            removeArtPatch(p, pageId, selection.id, artId),
          )
        }
        resolveAsset={resolveAsset}
      />
    )
  }
  if (selection.kind === 'bubble') {
    const found = findBubble(page, selection.id)
    if (!found) return <Typography tone="muted">{m.web_editor_bubble_gone()}</Typography>
    return (
      <BubbleInspector
        key={selection.id}
        bubble={found.bubble}
        characters={characters}
        onChange={(patch) =>
          apply(m.web_editor_history_edit_bubble(), (p) =>
            bubblePatch(p, pageId, selection.id, patch),
          )
        }
      />
    )
  }
  if (selection.kind === 'focus') {
    const found = findFocus(page, selection.id)
    if (!found) return <Typography tone="muted">{m.web_editor_focus_gone()}</Typography>
    return (
      <FocusInspector
        key={selection.id}
        focus={found.focus}
        characters={characters}
        diagnosis={
          GAZE_EVALUATION
            ? diagnosis?.panels
                .find((d) => d.panelId === found.panel.id)
                ?.focus.find((f) => f.focusPointId === selection.id)
            : undefined
        }
        onChange={(patch) =>
          apply(m.web_editor_history_edit_focus(), (p) =>
            focusPatch(p, pageId, selection.id, patch),
          )
        }
      />
    )
  }
  const found = findVector(page, selection.id)
  if (!found) return <Typography tone="muted">{m.web_editor_vector_gone()}</Typography>
  return (
    <VectorInspector
      key={selection.id}
      vector={found.vector}
      targets={[
        ...found.panel.focusPoints.map((f) => ({
          value: f.id,
          label: m.web_editor_vector_target_focus({ label: f.label || f.id }),
        })),
        ...found.panel.bubbles.map((b) => ({
          value: b.id,
          label: m
            .web_editor_vector_target_bubble({
              order: b.order,
              text: stripRuby(b.text).split('\n')[0] ?? '',
            })
            .trim(),
        })),
      ]}
      onChange={(patch) =>
        apply(m.web_editor_history_edit_vector(), (p) =>
          vectorPatch(p, pageId, selection.id, patch),
        )
      }
    />
  )
}

/**
 * クリップボードのファイルを onFile に渡す。文字入力欄への貼り付けとファイルを含まない貼り付けには触らない。`enabled` が false の間は受けない
 */
function useReferencePaste(onFile: (file: File) => void, enabled: boolean) {
  const onPaste = useEffectEvent((e: ClipboardEvent) => {
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
    onFile(file)
  })
  useEffect(() => {
    if (!enabled) return
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [enabled])
}

/** Desktop でウィンドウに落とした画像や PDF を onFile に渡す。`enabled` が false の間は受けない */
function useDroppedReference(onFile: (file: File) => void, enabled: boolean) {
  const onDrop = useEffectEvent(onFile)
  useEffect(() => {
    if (!enabled) return
    return receiveDroppedReference((file) => onDrop(file))
  }, [enabled])
}

/**
 * このページの登場キャラ。ページの `cast` とコマごとの登場キャラを集めて、何コマに出るかと参照画像の有無を並べる。
 * ページの `cast` はここで足し外しし、キャラ設定と参照画像の編集はキャラクター一覧に置く
 */
function PageCast({
  page,
  characters,
  projectId,
  onChange,
}: {
  page: Page
  characters: readonly Character[]
  projectId: ID
  /** path はページを root とする */
  onChange(patch: Patch): void
}) {
  const ids = pageCharacterIds(page)
  const panelIds = page.panels.flatMap(panelCharacterIds)
  const cast = ids.flatMap((id) => characters.filter((c) => c.id === id))
  const candidates = characters.filter((c) => !ids.includes(c.id))
  return (
    <details data-section="page-cast">
      <summary>{m.web_page_cast_title({ count: cast.length })}</summary>
      {cast.length === 0 ? (
        <Typography tone="muted">{m.web_page_cast_empty()}</Typography>
      ) : (
        <YStack as="ul" gap={2} className={styles.pageCast}>
          {cast.map((c) => (
            <XStack as="li" key={c.id} gap={6} data-cast-id={c.id}>
              <b>{c.name}</b>
              <Typography as="small" variant="caption" tone="muted">
                {m.web_page_cast_panel_count({
                  count: panelIds.filter((id) => id === c.id).length,
                })}
                {c.referenceRef === undefined && m.web_page_cast_no_reference()}
              </Typography>
              {page.cast?.includes(c.id) && (
                <IconButton
                  size="small"
                  label={m.web_page_cast_remove({ name: c.name })}
                  onClick={() => onChange(removeCastPatch(page.cast, c.id))}
                >
                  ×
                </IconButton>
              )}
            </XStack>
          ))}
        </YStack>
      )}
      {candidates.length > 0 && (
        <Select
          label={m.web_page_cast_add()}
          hideLabel
          value=""
          onChange={(e) => {
            if (e.target.value) onChange(addCastPatch(page.cast, e.target.value))
          }}
        >
          <option value="">{m.web_page_cast_add_option()}</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
      <Typography tone="muted">
        <Link to="/p/$projectId/characters" params={{ projectId }}>
          {m.web_characters_title()}
        </Link>
        {m.web_page_cast_edit_hint()}
      </Typography>
    </details>
  )
}

export function PageNotFound() {
  const { projectId, pageId } = useParams({ strict: false })
  return (
    <YStack as="section" gap={16} align="start">
      <Typography variant="title">{m.web_not_found_page()}</Typography>
      <Typography>
        {projectId} / {pageId}
      </Typography>
      {projectId ? (
        <Link to="/p/$projectId" params={{ projectId }}>
          {m.web_episode_back_to_list()}
        </Link>
      ) : (
        <Link to="/">{m.web_back_to_project_list()}</Link>
      )}
    </YStack>
  )
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('pageAspectStyle passes the page ratio, doubled in width for a spread', () => {
    const size = { w: 182, h: 257 }
    expect(pageAspectStyle(pageSizeOf({ spread: false }, size))).toEqual({
      '--page-aspect': '182 / 257',
    })
    expect(pageAspectStyle(pageSizeOf({ spread: true }, size))).toEqual({
      '--page-aspect': '364 / 257',
    })
  })
}
