import type { LayoutSuggestionResponse, LlmProvider } from '@manga/ai'
import { m } from '@manga/i18n'
import type { ID, LayoutOption, Page, Project } from '@manga/schema'
import { Button, ConfirmDialog, Typography, XStack, YStack } from '@manga/ui'
import { useEffect, useRef, useState } from 'react'
import {
  hasLockedPanel,
  hasPanelContent,
  layoutRequest,
  replacePanelsPatch,
  suggestedPage,
  suggestedPanels,
} from './layout-suggestion'
import styles from './layout-suggestions.module.css'
import { PageThumbnail } from './page-thumbnail'
import { findPage } from './project-ops'
import { errorMessage } from './route-error'
import { FailureAlert } from './sign-in'
import type { ProjectStore } from './store/project-store'

type Suggestion =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'done'; response: LayoutSuggestionResponse }

interface LayoutSuggestionsProps {
  store: ProjectStore
  project: Project
  page: Page
  pageId: ID
  llmProvider: LlmProvider
  canEdit: boolean
}

/**
 * 「脚本からコマ割りを提案」。ページの脚本を LlmProvider.suggestLayout に送り、案ごとにコマ割りの縮図と狙いを並べる。
 * 「このコマ割りにする」でページのコマを案のコマ（指示メモ、カメラ、フキダシつき）に置き換え、`source: 'ai'` の 1 手として入れる。
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
  const [suggestion, setSuggestion] = useState<Suggestion>({ status: 'idle' })
  const [confirming, setConfirming] = useState<LayoutOption>()
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

  const ask = async () => {
    const id = ++requestId.current
    setSuggestion({ status: 'loading' })
    setApplyError(undefined)
    try {
      const response = await llmProvider.suggestLayout(layoutRequest(project, script))
      if (requestId.current === id) setSuggestion({ status: 'done', response })
    } catch (e) {
      if (requestId.current === id) setSuggestion({ status: 'error', error: e })
    }
  }

  const apply = (option: LayoutOption) => {
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
          suggestedPanels(option, current.settings, current.characters),
        ),
        { source: 'ai', label: m.web_layout_suggest_history() },
      )
      setApplyError(undefined)
    } catch (e) {
      setApplyError(errorMessage(e))
    }
  }

  const loading = suggestion.status === 'loading'
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
          variant="primary"
          disabled={!canEdit || loading || script === ''}
          onClick={() => void ask()}
        >
          {loading
            ? m.web_layout_suggesting()
            : suggestion.status === 'done'
              ? m.web_layout_suggest_again()
              : m.web_layout_suggest()}
        </Button>
      </XStack>
      {script === '' && (
        <Typography variant="caption" tone="muted">
          {m.web_layout_suggest_needs_script()}
        </Typography>
      )}
      {suggestion.status === 'error' && (
        <FailureAlert failure={m.web_layout_suggest_failed()} error={suggestion.error} />
      )}
      {suggestion.status === 'done' && (
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
                      page={suggestedPage(page, option, project.settings, project.characters)}
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
                    onClick={() => (hasPanelContent(page) ? setConfirming(option) : apply(option))}
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
          onConfirm={() => apply(confirming)}
          onCancel={() => setConfirming(undefined)}
        />
      )}
    </YStack>
  )
}
