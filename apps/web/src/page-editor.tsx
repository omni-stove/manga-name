import { diagnosePage } from '@manga/diagnosis'
import {
  type CanvasMenuRequest,
  convertSketchPatch,
  EditorCanvas,
  type Layers,
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
  panelCharacterIds,
} from '@manga/schema'
import {
  Button,
  Checkbox,
  ContextMenu,
  type ContextMenuItem,
  IconButton,
  SegmentedControl,
  type SegmentedOption,
  Select,
  Sidebar,
  Typography,
  XStack,
  YStack,
} from '@manga/ui'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { type ReactNode, useEffect, useEffectEvent, useState } from 'react'
import { useStore } from 'zustand'
import { BatchOptions, useBatchGeneration } from './batch-generation'
import { elementMenuItems, shapeMenuItems, toolMenuItems } from './canvas-menu'
import { CollaborationBar, PeerBadge, peerColor, usePeers } from './collaboration-view'
import { previewPage } from './critique'
import { CritiquePanel } from './critique-panel'
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
import { HistoryButtons, Icon, MOD } from './history-buttons'
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
import { LayoutTemplateDialog } from './layout-templates'
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
import { SaveStatusIndicator } from './save-status'
import { ROLE_LABELS } from './sharing'
import { Spotlight } from './spotlight'
import type { Peer } from './store/presence'
import type { WebProjectStore } from './store/project-store'
import { toasts } from './toasts'
import { useAssetResolver } from './use-asset-resolver'
import { useKeyShortcuts } from './use-key-shortcuts'
import { useApplyPatch, useProject } from './use-project'
import { useStoredFlag } from './use-stored-flag'
import { useUndoShortcuts } from './use-undo-shortcuts'

// 数字キーはペンと焦点の種別に使うので、ツールは英字にする
const toolOptions = (): readonly SegmentedOption<Tool>[] => [
  { value: 'select', label: m.web_editor_tool_select(), shortcut: 'v' },
  { value: 'panel', label: m.web_editor_tool_panel(), shortcut: 'p' },
  { value: 'bubble', label: m.web_editor_tool_bubble(), shortcut: 'b' },
  { value: 'focus', label: m.web_editor_tool_focus(), shortcut: 'f' },
  { value: 'vector', label: m.web_editor_tool_vector(), shortcut: 'a' },
  { value: 'scribble', label: m.web_editor_tool_scribble(), shortcut: 'd' },
  { value: 'sketch', label: m.web_editor_tool_sketch(), shortcut: 'n' },
]

const scribbleToolOptions = (): readonly SegmentedOption<ScribbleTool>[] => [
  { value: 'ink', label: m.web_editor_pen_ink(), shortcut: '1' },
  { value: 'red', label: m.web_editor_pen_red(), shortcut: '2' },
  { value: 'blue', label: m.web_editor_pen_blue(), shortcut: '3' },
  { value: 'eraser', label: m.web_editor_pen_eraser(), shortcut: '4' },
]

const sketchToolOptions = (): readonly SegmentedOption<SketchTool>[] => [
  { value: 'pen', label: m.web_editor_sketch_pen(), shortcut: '1' },
  { value: 'eraser', label: m.web_editor_pen_eraser(), shortcut: '2' },
]

const focusKindOptions = (): readonly SegmentedOption<FocusKind>[] =>
  FOCUS_KINDS.map((k, i) => ({ value: k.value, label: k.label, shortcut: String(i + 1) }))

const PREV_PAGE_KEY = '['
const NEXT_PAGE_KEY = ']'

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
// そのため診断レイヤー、読み順と焦点の集計、診断の問題、AI に相談を出さない。生成プロンプトのヒントは残す
const GAZE_EVALUATION = false

const layerOptions = (): readonly { key: keyof Layers; label: string }[] => [
  { key: 'reference', label: m.web_editor_layer_reference() },
  { key: 'art', label: m.web_editor_layer_art() },
  { key: 'scribble', label: m.web_editor_layer_scribble() },
  { key: 'sketch', label: m.web_editor_layer_sketch() },
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

/**
 * 編集画面のうち、まとめて使えるようにしたり止めたりする領域。
 * `navigation` はページ送り、`canvas` はキャンバスの操作と参考画像の取り込み、`inspector` は要素一覧と要素とページの編集とページの脚本、
 * `generate` は「このページを全部生成」と「生成済みも含める」
 */
export type EditorArea =
  | 'navigation'
  | 'history'
  | 'tools'
  | 'layers'
  | 'export'
  | 'canvas'
  | 'inspector'
  | 'generate'

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
  /** 手順の案内。`target` 以外をぼかして押せなくし、`target` に `message` の吹き出しを向ける */
  guide?: { target: GuideTarget; message: string }
  /** ツールバーの右端、書き出しの前に足す操作 */
  actions?: ReactNode
}

/** 案内で吹き出しを向けられる操作。`generate` は「このページを全部生成」、`layers` はレイヤーの切り替え */
export type GuideTarget = 'generate' | 'layers'

const GUIDE_TARGETS: Record<GuideTarget, string> = {
  generate: '[data-action="generate-all"]',
  layers: '[data-area="layers"]',
}

// キャンバスは案内が指す丸や矢印と、生成した絵を見せる所なのでぼかさない。`actions` は案内する側が足した操作
const GUIDE_KEEP = ['[data-area="canvas"]', '[data-area="actions"]']

/** `open` でなければ中身を見た目そのままで押せなくし、フォーカスも当てない */
function Area({ open, children }: { open: boolean; children: ReactNode }) {
  if (open) return children
  return (
    <fieldset disabled inert className={styles.locked}>
      {children}
    </fieldset>
  )
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

/** 開いている右クリックメニュー。`shapes` はフキダシの形を選ぶメニューに切り替えたあと */
type OpenMenu = CanvasMenuRequest & { shapes?: boolean }

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
  guide,
  actions,
}: PageEditorProps) {
  const can = (area: EditorArea) => unlocked?.has(area) ?? true
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
  const [focusKind, setFocusKind] = useState<FocusKind>('face')
  const [layers, setLayers] = useState<Layers>(ALL_LAYERS)
  const [selected, setSelection] = useState<Selection>(null)
  const [exporting, setExporting] = useState<Exporting>('closed')
  const [inspectorExpanded, setInspectorExpanded] = useStoredFlag('manga.inspector.expanded', true)
  const [scriptExpanded, setScriptExpanded] = useStoredFlag('manga.script.expanded', true)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [registeringLayout, setRegisteringLayout] = useState(false)
  const canUndo = useStore(store.state, (s) => s.canUndo)
  const canRedo = useStore(store.state, (s) => s.canRedo)
  useUndoShortcuts(store, can('history'))
  const navigate = useNavigate()
  const scribbleTools = scribbleToolOptions()
  const sketchTools = sketchToolOptions()
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
  const diagnosis = foundPage ? diagnosePage(foundPage, project.settings) : null
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
    ...(tool === 'focus' ? shortcutsOf(focusKindOptions(), setFocusKind) : {}),
    ...(can('navigation')
      ? {
          [PREV_PAGE_KEY]: () => prevPage && openPage(prevPage.id),
          [NEXT_PAGE_KEY]: () => nextPage && openPage(nextPage.id),
        }
      : {}),
  })

  useEffect(() => {
    collab?.presence.setLocation({ pageId, selection: selectedId ? [selectedId] : [] })
  }, [collab, pageId, selectedId])
  useEffect(() => () => collab?.presence.setLocation({ pageId: null, selection: [] }), [collab])

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
  const exportPages = async ({ format, from, to, dpi, ...opts }: ExportSettings) => {
    const total = to - from + 1
    const numbers = Array.from({ length: total }, (_, i) => from + i)
    const ext = format === 'pdf' ? 'pdf' : total === 1 ? 'png' : 'zip'
    setExporting({ done: 0, total })
    try {
      const pageIds = episode.pages.slice(from - 1, to).map((p) => p.id)
      const width = Math.round((project.settings.pageSize.w / MM_PER_INCH) * dpi)
      const job = await collectExportJob(
        project,
        episode.id,
        pageIds,
        format,
        { ...opts, width },
        library.loadAsset,
      )
      const blob = await pageExporter.run(job, (done) => setExporting({ done, total }))
      await saveFile(blob, exportFileName(project.title, numbers, ext), [
        { name: ext.toUpperCase(), extensions: [ext] },
      ])
    } catch (e) {
      toasts.push(m.web_page_export_failed({ reason: errorMessage(e) }))
    }
    setExporting('closed')
  }
  const convertSketch = () => {
    let converted = { panels: 0, bubbles: 0 }
    const applied = apply(m.web_editor_history_convert_sketch(), (p) => {
      const current = findPage(p, pageId)
      if (!current) throw new Error(m.web_common_page_gone())
      const { patch, ...counts } = convertSketchPatch(
        current.page,
        p.settings.pageSize,
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
    { label: 'Undo', shortcut: `${MOD}Z`, disabled: !canUndo, onSelect: () => store.undo() },
    { label: 'Redo', shortcut: `${MOD}Shift+Z`, disabled: !canRedo, onSelect: () => store.redo() },
  ]
  const pageMenuItems: (ContextMenuItem | 'separator')[] = [
    ...undoItems,
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
    tools,
    edit: (label: string, target: NonNullable<Selection>, patch: Patch) =>
      apply(label, (p) => elementPatch(p, pageId, target, patch)),
    remove: (target: NonNullable<Selection>) => {
      const removed = apply(m.web_editor_history_remove_element(), (p) => {
        const current = findPage(p, pageId)
        if (!current) throw new Error(m.web_common_page_gone())
        return pagePatch(p, pageId, removePatch(current.page, target))
      })
      if (removed) setSelection(null)
    },
    setTool,
    openShapes: () => menu && setMenu({ ...menu, shapes: true }),
  }
  const shapesOf =
    menuTarget?.kind === 'bubble' && menu?.shapes ? findBubble(page, menuTarget.id) : undefined
  const openMenu = menu && {
    label: shapesOf
      ? m.web_editor_menu_bubble_shapes()
      : menuTarget
        ? MENU_LABELS[menuTarget.kind]()
        : m.web_editor_page_menu(),
    items: shapesOf
      ? shapeMenuItems(shapesOf.bubble, menuContext)
      : menuTarget
        ? [...elementMenuItems(menuTarget, menuContext), 'separator' as const, ...undoItems]
        : pageMenuItems,
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
      <XStack as="header" gap={20} rowGap={12} wrap className={styles.toolbar}>
        <Typography as="span" variant="label" tone="muted">
          {project.title || m.web_common_untitled()}
        </Typography>
        <Area open={can('navigation')}>
          <Link
            to="/p/$projectId/episodes/$episodeId"
            params={{ projectId, episodeId: episode.id }}
          >
            {episode.title}
          </Link>
          <XStack as="span" gap={2} role="group" aria-label={m.web_editor_page_navigation()}>
            <IconButton
              size="small"
              label={m.web_editor_prev_page()}
              title={m.web_editor_prev_page_title({ key: PREV_PAGE_KEY })}
              aria-keyshortcuts={PREV_PAGE_KEY}
              disabled={!prevPage}
              onClick={() => prevPage && openPage(prevPage.id)}
            >
              <Icon>
                <path d="m15 6-6 6 6 6" />
              </Icon>
            </IconButton>
            <Select
              label={m.web_editor_page()}
              hideLabel
              value={pageId}
              className={styles.pageSelect}
              onChange={(e) => openPage(e.target.value)}
            >
              {episode.pages.map((p, i) => (
                <option key={p.id} value={p.id}>
                  {m.web_editor_page_option({ index: i + 1, total: episode.pages.length })}
                </option>
              ))}
            </Select>
            <IconButton
              size="small"
              label={m.web_editor_next_page()}
              title={m.web_editor_next_page_title({ key: NEXT_PAGE_KEY })}
              aria-keyshortcuts={NEXT_PAGE_KEY}
              disabled={!nextPage}
              onClick={() => nextPage && openPage(nextPage.id)}
            >
              <Icon>
                <path d="m9 6 6 6-6 6" />
              </Icon>
            </IconButton>
          </XStack>
        </Area>
        <CollaborationBar collab={collab} project={project} />
        {!canEdit && (
          <Typography as="span" tone="muted">
            {ROLE_LABELS[role]}
          </Typography>
        )}
        <Area open={can('history')}>
          <HistoryButtons store={store} />
        </Area>
        <Area open={can('tools')}>
          <SegmentedControl
            label={m.web_editor_tools()}
            value={tool}
            options={tools}
            onChange={(t) => setTool(t)}
          />
          {tool === 'scribble' && (
            <SegmentedControl
              label={m.web_editor_pen()}
              value={scribbleTool}
              options={scribbleTools}
              onChange={(t) => setScribbleTool(t)}
            />
          )}
          {tool === 'sketch' && (
            <>
              <SegmentedControl
                label={m.web_editor_pen()}
                value={sketchTool}
                options={sketchTools}
                onChange={(t) => setSketchTool(t)}
              />
              <Button size="small" disabled={!page.sketch?.length} onClick={convertSketch}>
                {m.web_editor_convert_sketch()}
              </Button>
            </>
          )}
          {tool === 'focus' && (
            <SegmentedControl
              label={m.web_editor_focus_kind()}
              value={focusKind}
              options={focusKindOptions()}
              onChange={(k) => setFocusKind(k)}
            />
          )}
        </Area>
        <Area open={can('layers')}>
          <XStack role="group" aria-label={m.web_editor_layers()} data-area="layers">
            <Typography as="span" variant="label" tone="muted" aria-hidden>
              {m.web_editor_layers()}
            </Typography>
            {layerOptions().map((l) => (
              <Checkbox
                key={l.key}
                label={l.label}
                checked={layers[l.key]}
                onChange={(e) => setLayers({ ...layers, [l.key]: e.target.checked })}
              />
            ))}
          </XStack>
        </Area>
        <XStack as="span" gap={6} className={styles.actions}>
          <SaveStatusIndicator store={store} />
          {actions && (
            <XStack as="span" gap={6} data-area="actions">
              {actions}
            </XStack>
          )}
          <Area open={can('export')}>
            {typeof exporting === 'object' ? (
              <XStack as="span" className={styles.exportProgress} role="status">
                {m.web_editor_exporting({ done: exporting.done, total: exporting.total })}
                <progress
                  aria-label={m.web_editor_export_progress()}
                  value={exporting.done}
                  max={exporting.total}
                />
              </XStack>
            ) : (
              <Button size="small" variant="primary" onClick={() => setExporting('dialog')}>
                {m.web_editor_export()}
              </Button>
            )}
          </Area>
        </XStack>
      </XStack>
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
          onCancel={() => setExporting('closed')}
          onExport={(settings) => void exportPages(settings)}
          onExportProject={exportProject}
        />
      )}
      {guide && (
        <Spotlight target={GUIDE_TARGETS[guide.target]} keep={GUIDE_KEEP}>
          {guide.message}
        </Spotlight>
      )}
      {error && (
        <Typography tone="alert" className={styles.error}>
          {error}
        </Typography>
      )}
      <div className={styles.body}>
        <Sidebar
          title={m.web_editor_script()}
          side="left"
          expanded={scriptExpanded}
          onExpandedChange={setScriptExpanded}
          className={styles.scriptSidebar}
        >
          <Area open={can('inspector')}>
            <PageScriptInspector
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
            selection={selection}
            tool={tool}
            scribbleTool={scribbleTool}
            sketchTool={sketchTool}
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
          />
        </div>
        <Sidebar
          title={m.web_editor_inspector()}
          side="right"
          // 吹き出しを向けるボタンが畳んだサイドバーの中に隠れないよう、案内の間は開いたままにする
          expanded={inspectorExpanded || guide?.target === 'generate'}
          onExpandedChange={setInspectorExpanded}
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
              <details open={selection === null}>
                <summary>{m.web_editor_page()}</summary>
                <PageInspector
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
            {GAZE_EVALUATION && diagnosis && (
              <details open data-section="issues">
                <summary>
                  {m.web_editor_diagnosis_issues({ count: diagnosis.issues.length })}
                </summary>
                <IssueList
                  issues={diagnosis.issues}
                  onFocus={(issue) => {
                    const target = issueTarget(page, issue)
                    if (target) setSelection(target)
                  }}
                />
                <CritiquePanel
                  key={pageId}
                  store={store}
                  page={page}
                  pageId={pageId}
                  pageSize={project.settings.pageSize}
                  diagnosis={diagnosis}
                  llmProvider={llmProvider}
                  canEdit={canEdit}
                  generating={generating}
                  onPreview={setPreview}
                  onGenerate={generate}
                />
              </details>
            )}
          </div>
        </Sidebar>
      </div>
    </YStack>
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
                            {m.web_editor_outline_bubble({
                              order: bubble.order,
                              text: bubble.text || m.web_editor_outline_bubble_empty(),
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
            .web_editor_vector_target_bubble({ order: b.order, text: b.text.split('\n')[0] ?? '' })
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
          {m.web_page_cast_character_list()}
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
      <Typography variant="title">{m.web_page_not_found()}</Typography>
      <Typography>
        {projectId} / {pageId}
      </Typography>
      {projectId ? (
        <Link to="/p/$projectId" params={{ projectId }}>
          {m.web_page_not_found_to_episodes()}
        </Link>
      ) : (
        <Link to="/">{m.web_page_not_found_to_projects()}</Link>
      )}
    </YStack>
  )
}
