import type { LayoutSuggestionResponse, LlmProvider } from '@manga/ai'
import { m } from '@manga/i18n'
import {
  CameraSchema,
  type Character,
  type ID,
  type LayoutOption,
  MAX_NAME_PANELS,
  type NamePanel,
  type Page,
  type PlanLine,
  type Project,
} from '@manga/schema'
import {
  Button,
  ConfirmDialog,
  IconButton,
  Select,
  TextArea,
  Typography,
  XStack,
  YStack,
} from '@manga/ui'
import { useEffect, useRef, useState } from 'react'
import {
  hasLockedPanel,
  hasPanelContent,
  isNameReady,
  layoutRequest,
  loadName,
  moveEdgeLine,
  nameRequest,
  replacePanelsPatch,
  saveName,
  suggestedPage,
  suggestedPanels,
} from './layout-suggestion'
import styles from './layout-suggestions.module.css'
import { LineEditor } from './line-editor'
import { PageThumbnail } from './page-thumbnail'
import { findPage } from './project-ops'
import { errorMessage } from './route-error'
import { FailureAlert } from './sign-in'
import type { ProjectStore } from './store/project-store-types'

type Request<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'done'; response: T }

interface LayoutSuggestionsProps {
  store: ProjectStore
  project: Project
  page: Page
  pageId: ID
  llmProvider: LlmProvider
  canEdit: boolean
}

/**
 * 脚本からコマ割りまでを 2 段で提案する。
 * 「脚本からネームを書き起こす」でページの脚本を LlmProvider.transcribeName に送り、読む順のコマごとの描くもの、カメラ、
 * セリフを並べて、コマとセリフを足し引きし、セリフを隣のコマへ移して直せるようにする。
 * 「ネームを自分で書く」で空のコマ 1 つから書き始めることもでき、脚本が無くてもネームから先へ進める。
 * 直したネームはこのブラウザにページごとに残す。
 * 「脚本からコマ割りまで提案」は書き起こしたネームを直さずにそのままコマ割りの提案へ送る。描くものの空いたコマがあれば提案は送らない。
 * 「このネームでコマ割りを提案」でネームを LlmProvider.suggestLayout に送り、案ごとにネームを当てたコマ割りの縮図と狙いを並べる。
 * コマを足し引きすると、数の合わなくなった案は消す。
 * 「このコマ割りにする」でページのコマを案の枠にネームを当てたコマ（指示メモ、カメラ、フキダシつき）に置き換え、`source: 'ai'` の 1 手として入れる。
 * 今のコマに絵やフキダシがあれば確かめてから置き換え、位置をロックしたコマがあれば置き換えない。
 * ページを替えるときは key で作り直し、遅れて届いた応答は捨てる
 */
export function LayoutSuggestions({
  store,
  project,
  page,
  pageId,
  llmProvider,
  canEdit,
}: LayoutSuggestionsProps) {
  const [name, setNameState] = useState<NamePanel[] | undefined>(() => loadName(pageId))
  const [transcription, setTranscription] = useState<Request<undefined>>({ status: 'idle' })
  const [suggestion, setSuggestion] = useState<Request<LayoutSuggestionResponse>>({
    status: 'idle',
  })
  const [confirming, setConfirming] = useState<{ option: LayoutOption; name: NamePanel[] }>()
  const [applyError, setApplyError] = useState<string>()
  const requestId = useRef(0)

  useEffect(
    () => () => {
      requestId.current++
    },
    [],
  )

  const script = page.script?.trim() ?? ''
  const locked = hasLockedPanel(page)

  const setName = (next: NamePanel[]) => {
    if (next.length !== name?.length) {
      // 案の枠はネームのコマと 1 対 1 なので、コマの数が変われば案を使えない
      requestId.current++
      setSuggestion({ status: 'idle' })
    }
    setNameState(next)
    saveName(pageId, next)
  }

  const transcribe = async (then: 'edit' | 'suggest') => {
    const id = ++requestId.current
    setTranscription({ status: 'loading' })
    setSuggestion({ status: 'idle' })
    setApplyError(undefined)
    let panels: NamePanel[]
    try {
      panels = (await llmProvider.transcribeName(nameRequest(project, script))).panels
    } catch (e) {
      if (requestId.current === id) setTranscription({ status: 'error', error: e })
      return
    }
    if (requestId.current !== id) return
    setTranscription({ status: 'done', response: undefined })
    setName(panels)
    if (then === 'suggest' && isNameReady(panels)) await ask(panels)
  }

  const ask = async (panels: NamePanel[]) => {
    const id = ++requestId.current
    setSuggestion({ status: 'loading' })
    setApplyError(undefined)
    try {
      const response = await llmProvider.suggestLayout(layoutRequest(panels))
      if (requestId.current === id) setSuggestion({ status: 'done', response })
    } catch (e) {
      if (requestId.current === id) setSuggestion({ status: 'error', error: e })
    }
  }

  const apply = (option: LayoutOption, panels: NamePanel[]) => {
    setConfirming(undefined)
    const current = store.get()
    const currentPage = findPage(current, pageId)?.page
    if (!currentPage) {
      setApplyError(m.web_common_page_gone())
      return
    }
    if (hasLockedPanel(currentPage)) {
      setApplyError(m.web_layout_suggest_locked())
      return
    }
    try {
      store.applyPatch(
        replacePanelsPatch(
          current,
          pageId,
          suggestedPanels(currentPage, option, panels, current.settings, current.characters),
        ),
        { source: 'ai', label: m.web_layout_suggest_history() },
      )
      setApplyError(undefined)
    } catch (e) {
      setApplyError(errorMessage(e))
    }
  }

  const transcribing = transcription.status === 'loading'
  const loading = suggestion.status === 'loading'
  const busy = transcribing || loading
  return (
    <YStack
      as="section"
      gap={8}
      className={styles.suggestions}
      data-layout-suggestion={suggestion.status}
    >
      <XStack wrap>
        <Button
          size="small"
          variant={name === undefined ? 'primary' : 'secondary'}
          disabled={!canEdit || busy || script === ''}
          onClick={() => void transcribe('edit')}
        >
          {transcribing
            ? m.web_name_transcribing()
            : name === undefined
              ? m.web_name_transcribe()
              : m.web_name_transcribe_again()}
        </Button>
        <Button
          size="small"
          variant="secondary"
          disabled={!canEdit || busy || script === ''}
          onClick={() => void transcribe('suggest')}
        >
          {m.web_name_transcribe_and_suggest()}
        </Button>
        {name === undefined && (
          <Button
            size="small"
            variant="secondary"
            disabled={!canEdit || busy}
            onClick={() => setName([{ note: '', lines: [] }])}
          >
            {m.web_name_write()}
          </Button>
        )}
      </XStack>
      {script === '' && (
        <Typography variant="caption" tone="muted">
          {m.web_name_needs_script()}
        </Typography>
      )}
      {transcription.status === 'error' && (
        <FailureAlert failure={m.web_name_transcribe_failed()} error={transcription.error} />
      )}
      {name !== undefined && (
        <>
          <NameEditor
            panels={name}
            characters={project.characters}
            disabled={!canEdit || transcribing}
            onChange={setName}
          />
          <XStack wrap>
            <Button
              size="small"
              variant="primary"
              disabled={!canEdit || busy || !isNameReady(name)}
              onClick={() => void ask(name)}
            >
              {loading
                ? m.web_layout_suggesting()
                : suggestion.status === 'done'
                  ? m.web_layout_suggest_again()
                  : m.web_layout_suggest()}
            </Button>
          </XStack>
          {!isNameReady(name) && (
            <Typography variant="caption" tone="muted">
              {m.web_name_needs_note()}
            </Typography>
          )}
        </>
      )}
      {suggestion.status === 'error' && (
        <FailureAlert failure={m.web_layout_suggest_failed()} error={suggestion.error} />
      )}
      {suggestion.status === 'done' && name !== undefined && (
        <>
          {locked && (
            <Typography variant="caption" tone="alert" role="alert">
              {m.web_layout_suggest_locked()}
            </Typography>
          )}
          <YStack as="ol" gap={8} className={styles.options}>
            {suggestion.response.options.map((option, i) => (
              <YStack
                as="li"
                gap={6}
                // biome-ignore lint/suspicious/noArrayIndexKey: 案の列は応答ごとに固定で並び替わらない
                key={i}
                className={styles.option}
                data-layout-option={i + 1}
              >
                <XStack gap={8} align="start">
                  <div className={styles.thumbnail}>
                    <PageThumbnail
                      page={suggestedPage(page, option, name, project.settings, project.characters)}
                      pageSize={project.settings.pageSize}
                    />
                  </div>
                  <YStack gap={4}>
                    <Typography variant="label" tone="muted">
                      {m.web_layout_suggest_option({
                        n: i + 1,
                        panels: option.rows.reduce((n, row) => n + row.panels.length, 0),
                      })}
                    </Typography>
                    <Typography variant="caption">{option.summary}</Typography>
                  </YStack>
                </XStack>
                <XStack wrap>
                  <Button
                    size="small"
                    disabled={!canEdit || locked}
                    onClick={() =>
                      hasPanelContent(page) ? setConfirming({ option, name }) : apply(option, name)
                    }
                  >
                    {m.web_layout_suggest_apply()}
                  </Button>
                </XStack>
              </YStack>
            ))}
          </YStack>
        </>
      )}
      {applyError && (
        <Typography tone="alert" role="alert">
          {m.web_layout_suggest_apply_failed({ reason: applyError })}
        </Typography>
      )}
      {confirming && (
        <ConfirmDialog
          title={m.web_layout_suggest_confirm_title()}
          message={m.web_layout_suggest_confirm_message()}
          confirmLabel={m.web_layout_suggest_apply()}
          onConfirm={() => apply(confirming.option, confirming.name)}
          onCancel={() => setConfirming(undefined)}
        />
      )}
    </YStack>
  )
}

/** ネームのコマを読む順に並べ、描くもの、カメラ、セリフを直し、コマとセリフを足し引きできるようにする */
function NameEditor({
  panels,
  characters,
  disabled,
  onChange,
}: {
  panels: NamePanel[]
  characters: readonly Character[]
  disabled: boolean
  onChange(next: NamePanel[]): void
}) {
  const editPanel = (index: number, next: (p: NamePanel) => NamePanel) =>
    onChange(panels.map((p, i) => (i === index ? next(p) : p)))
  const editLines = (index: number, next: (lines: PlanLine[]) => PlanLine[]) =>
    editPanel(index, (p) => ({ ...p, lines: next(p.lines) }))

  return (
    <YStack gap={6} as="fieldset" className={styles.fieldset} disabled={disabled}>
      <Typography as="legend" variant="label" tone="muted">
        {m.web_name_section()}
      </Typography>
      <ol className={styles.panels}>
        {panels.map((panel, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: コマに id が無く、入力中の欄は位置で追えば足りる
          <YStack as="li" gap={6} key={index} className={styles.panel} data-name-panel={index + 1}>
            <XStack justify="between">
              <Typography variant="label">{m.web_name_panel({ n: index + 1 })}</Typography>
              <IconButton
                size="small"
                label={m.web_name_remove_panel()}
                disabled={panels.length === 1}
                onClick={() => onChange(panels.filter((_, i) => i !== index))}
              >
                ×
              </IconButton>
            </XStack>
            <TextArea
              label={m.panel_note()}
              rows={2}
              value={panel.note}
              onChange={(e) => editPanel(index, (p) => ({ ...p, note: e.target.value }))}
            />
            <Select
              label={m.panel_camera()}
              value={panel.camera ?? ''}
              onChange={(e) => {
                const camera = CameraSchema.safeParse(e.currentTarget.value)
                editPanel(index, ({ camera: _, ...rest }) =>
                  camera.success ? { ...rest, camera: camera.data } : rest,
                )
              }}
            >
              <option value="">{m.none()}</option>
              {CameraSchema.options.map((camera) => (
                <option key={camera} value={camera}>
                  {m[`panel_camera_${camera}`]()}
                </option>
              ))}
            </Select>
            {panel.lines.length === 0 && (
              <Typography variant="caption" tone="muted">
                {m.web_draft_no_lines()}
              </Typography>
            )}
            <ol className={styles.lines}>
              {panel.lines.map((line, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: セリフに id が無く、入力中の欄は位置で追えば足りる
                <li key={j} className={styles.line} data-name-line>
                  <LineEditor
                    line={line}
                    characters={characters}
                    onChange={(next) =>
                      editLines(index, (lines) => lines.map((l, k) => (k === j ? next : l)))
                    }
                  />
                  <XStack gap={2}>
                    {j === 0 && index > 0 && (
                      <IconButton
                        size="small"
                        label={m.web_name_line_to_previous_panel()}
                        onClick={() => onChange(moveEdgeLine(panels, index, -1))}
                      >
                        ↑
                      </IconButton>
                    )}
                    {j === panel.lines.length - 1 && index < panels.length - 1 && (
                      <IconButton
                        size="small"
                        label={m.web_name_line_to_next_panel()}
                        onClick={() => onChange(moveEdgeLine(panels, index, 1))}
                      >
                        ↓
                      </IconButton>
                    )}
                    <IconButton
                      size="small"
                      label={m.web_draft_remove_line()}
                      onClick={() => editLines(index, (lines) => lines.filter((_, k) => k !== j))}
                    >
                      ×
                    </IconButton>
                  </XStack>
                </li>
              ))}
            </ol>
            <Button
              size="small"
              variant="ghost"
              className={styles.add}
              onClick={() => editLines(index, (lines) => [...lines, { text: '', shape: 'normal' }])}
            >
              {m.web_draft_add_line()}
            </Button>
          </YStack>
        ))}
      </ol>
      <Button
        size="small"
        variant="ghost"
        className={styles.add}
        disabled={panels.length >= MAX_NAME_PANELS}
        onClick={() => onChange([...panels, { note: '', lines: [] }])}
      >
        {m.web_name_add_panel()}
      </Button>
    </YStack>
  )
}

if (import.meta.vitest) {
  const { describe, expect, onTestFinished, test, vi } = import.meta.vitest
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { aiFixtures, createFakeLlmProvider } = await import('@manga/ai')
  const { fixtures } = await import('@manga/schema')

  const html = (panels: NamePanel[]) =>
    renderToStaticMarkup(
      <NameEditor
        panels={panels}
        characters={fixtures.samplePage01.characters}
        disabled={false}
        onChange={vi.fn()}
      />,
    )

  describe('LayoutSuggestions', () => {
    const project = fixtures.samplePage01
    const page = project.episodes[0]?.pages[0] as Page
    const markup = (script: string | undefined, canEdit = true) =>
      renderToStaticMarkup(
        <LayoutSuggestions
          store={{} as ProjectStore}
          project={project}
          page={{ ...page, script }}
          pageId={page.id}
          llmProvider={createFakeLlmProvider()}
          canEdit={canEdit}
        />,
      )

    test('asks for a script before the name can be transcribed', () => {
      expect(markup(undefined)).toContain(m.web_name_needs_script())
      expect(markup('E「……」')).not.toContain(m.web_name_needs_script())
      expect(markup('E「……」')).toContain(m.web_name_transcribe())
      expect(markup(undefined)).toContain(m.web_name_write())
    })

    test('shows the name kept in this browser and asks for a note on every panel', () => {
      const stored = new Map<string, string>()
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      })
      onTestFinished(() => {
        vi.unstubAllGlobals()
      })
      saveName(page.id, aiFixtures.nameDraft.panels)
      const ready = markup('E「……」')
      expect(ready).toContain(m.web_name_transcribe_again())
      expect(ready).toContain(m.web_layout_suggest())
      expect(ready).not.toContain(m.web_name_needs_note())
      saveName(page.id, [...aiFixtures.nameDraft.panels, { note: '', lines: [] }])
      expect(markup('E「……」')).toContain(m.web_name_needs_note())
    })
  })

  describe('NameEditor', () => {
    test('lists the panels in reading order with their notes and lines', () => {
      const markup = html(aiFixtures.nameDraft.panels)
      expect(markup.match(/data-name-panel=/g)).toHaveLength(aiFixtures.nameDraft.panels.length)
      for (const panel of aiFixtures.nameDraft.panels) {
        expect(markup).toContain(panel.note)
        for (const line of panel.lines) expect(markup).toContain(line.text)
      }
      expect(markup).toContain(m.web_name_line_to_next_panel())
      expect(markup).toContain(m.web_name_line_to_previous_panel())
    })

    test('says so for a panel without lines', () => {
      expect(html([{ note: 'n', lines: [] }])).toContain(m.web_draft_no_lines())
    })
  })
}
