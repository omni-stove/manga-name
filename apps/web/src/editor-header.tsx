import type { FillTool, Layers, ScribbleTool, SketchTool, Tool } from '@manga/editor-canvas'
import { m } from '@manga/i18n'
import type { Episode, FocusKind, ID, Project } from '@manga/schema'
import {
  Button,
  Checkbox,
  IconButton,
  SegmentedControl,
  type SegmentedOption,
  Select,
  Typography,
  XStack,
} from '@manga/ui'
import { BackLink } from './back-link'
import { CollaborationBar } from './collaboration-view'
import { Area, type EditorArea } from './editor-area'
import styles from './editor-header.module.css'
import { HistoryButtons, Icon } from './history-buttons'
import type { Collaboration } from './project-library'
import { SaveStatusIndicator } from './save-status'
import type { WebProjectStore } from './store/project-store-types'

export const PREV_PAGE_KEY = '['
export const NEXT_PAGE_KEY = ']'

/** ヘッダーの切り替えボタン 1 組の選択肢と、今の値と、選び直したときの操作 */
interface Choice<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange(value: T): void
}

export interface EditorHeaderProps {
  projectId: ID
  project: Project
  episode: Episode
  pageId: ID
  /** 前後のページ。端のページでは undefined */
  prevPageId: ID | undefined
  nextPageId: ID | undefined
  onOpenPage(pageId: ID): void
  /** ページを足すダイアログを開く。編集できない人には undefined */
  onAddPage: (() => void) | undefined
  collab: Collaboration | undefined
  /** 編集できない人に出す自分の役割。編集できる人には undefined */
  roleLabel: string | undefined
  store: WebProjectStore
  /** その領域を使えるか */
  can(area: EditorArea): boolean
  tool: Choice<Tool>
  scribbleTool: Choice<ScribbleTool>
  sketchTool: Choice<SketchTool>
  fillTool: Choice<FillTool>
  focusKind: Choice<FocusKind>
  /** 下描きをコマとフキダシに変換する。下描きが無ければ undefined */
  onConvertSketch: (() => void) | undefined
  layerOptions: readonly { key: keyof Layers; label: string }[]
  layers: Layers
  onLayersChange(layers: Layers): void
  /** 書き出しの進み具合。書き出していなければ undefined */
  exportProgress: { done: number; total: number } | undefined
  /** 書き出しダイアログを開く */
  onExport(): void
}

/**
 * 編集画面の上に並べるヘッダー。作品名、エピソードへ戻るリンクとページ送り、共同編集者、Undo と Redo、ツール、レイヤー、
 * 保存状態、書き出し。`can` で止めた領域は見た目そのままで押せなくする
 */
export function EditorHeader({
  projectId,
  project,
  episode,
  pageId,
  prevPageId,
  nextPageId,
  onOpenPage,
  onAddPage,
  collab,
  roleLabel,
  store,
  can,
  tool,
  scribbleTool,
  sketchTool,
  fillTool,
  focusKind,
  onConvertSketch,
  layerOptions,
  layers,
  onLayersChange,
  exportProgress,
  onExport,
}: EditorHeaderProps) {
  return (
    <XStack as="header" gap={20} rowGap={12} wrap className={styles.toolbar}>
      <Typography as="span" variant="label" tone="muted">
        {project.title || m.untitled()}
      </Typography>
      <Area open={can('navigation')}>
        <BackLink
          to="/p/$projectId/episodes/$episodeId"
          params={{ projectId, episodeId: episode.id }}
        >
          {episode.title}
        </BackLink>
        <XStack as="span" gap={2} role="group" aria-label={m.web_editor_page_navigation()}>
          <IconButton
            size="small"
            label={m.web_editor_prev_page()}
            title={m.web_editor_prev_page_title({ key: PREV_PAGE_KEY })}
            aria-keyshortcuts={PREV_PAGE_KEY}
            disabled={!prevPageId}
            onClick={() => prevPageId && onOpenPage(prevPageId)}
          >
            <Icon>
              <path d="m15 6-6 6 6 6" />
            </Icon>
          </IconButton>
          <Select
            label={m.page()}
            hideLabel
            value={pageId}
            className={styles.pageSelect}
            onChange={(e) => onOpenPage(e.target.value)}
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
            disabled={!nextPageId}
            onClick={() => nextPageId && onOpenPage(nextPageId)}
          >
            <Icon>
              <path d="m9 6 6 6-6 6" />
            </Icon>
          </IconButton>
          {onAddPage && (
            <IconButton size="small" label={m.web_episode_add_page()} onClick={onAddPage}>
              <Icon>
                <path d="M12 5v14M5 12h14" />
              </Icon>
            </IconButton>
          )}
        </XStack>
      </Area>
      <CollaborationBar collab={collab} project={project} />
      {roleLabel !== undefined && (
        <Typography as="span" tone="muted">
          {roleLabel}
        </Typography>
      )}
      <Area open={can('history')}>
        <HistoryButtons store={store} />
      </Area>
      <Area open={can('tools')}>
        <XStack as="span" gap={20} rowGap={12} wrap className={styles.strip} data-area="tools">
          <SegmentedControl
            label={m.web_editor_tools()}
            value={tool.value}
            options={tool.options}
            onChange={(t) => tool.onChange(t)}
          />
          {tool.value === 'scribble' && (
            <SegmentedControl
              label={m.web_editor_pen()}
              value={scribbleTool.value}
              options={scribbleTool.options}
              onChange={(t) => scribbleTool.onChange(t)}
            />
          )}
          {tool.value === 'sketch' && (
            <>
              <SegmentedControl
                label={m.web_editor_pen()}
                value={sketchTool.value}
                options={sketchTool.options}
                onChange={(t) => sketchTool.onChange(t)}
              />
              <Button size="small" disabled={!onConvertSketch} onClick={onConvertSketch}>
                {m.web_editor_convert_sketch()}
              </Button>
            </>
          )}
          {tool.value === 'fill' && (
            <SegmentedControl
              label={m.web_editor_fill_color()}
              value={fillTool.value}
              options={fillTool.options}
              onChange={(t) => fillTool.onChange(t)}
            />
          )}
          {tool.value === 'focus' && (
            <SegmentedControl
              label={m.web_editor_focus_kind()}
              value={focusKind.value}
              options={focusKind.options}
              onChange={(k) => focusKind.onChange(k)}
            />
          )}
        </XStack>
      </Area>
      <Area open={can('layers')}>
        <XStack
          role="group"
          aria-label={m.web_editor_layers()}
          className={styles.strip}
          data-area="layers"
        >
          <Typography as="span" variant="label" tone="muted" aria-hidden>
            {m.web_editor_layers()}
          </Typography>
          {layerOptions.map((l) => (
            <Checkbox
              key={l.key}
              label={l.label}
              checked={layers[l.key]}
              onChange={(e) => onLayersChange({ ...layers, [l.key]: e.target.checked })}
            />
          ))}
        </XStack>
      </Area>
      <XStack as="span" gap={6} className={styles.actions}>
        <SaveStatusIndicator store={store} />
        <Area open={can('export')}>
          {exportProgress ? (
            <XStack as="span" className={styles.exportProgress} role="status">
              {m.web_editor_exporting({ done: exportProgress.done, total: exportProgress.total })}
              <progress
                aria-label={m.web_editor_export_progress()}
                value={exportProgress.done}
                max={exportProgress.total}
              />
            </XStack>
          ) : (
            <Button size="small" variant="primary" data-guide="export" onClick={onExport}>
              {m.web_editor_export()}
            </Button>
          )}
        </Area>
      </XStack>
    </XStack>
  )
}
