import type { CritiqueResponse, LlmProvider } from '@manga/ai'
import type { ID, Page, PageDiagnosis, Patch, ProjectSettings } from '@manga/schema'
import { Button, Typography, XStack, YStack } from '@manga/ui'
import { useEffect, useRef, useState } from 'react'
import {
  applySuggestion,
  critiqueRequest,
  type Suggestion,
  type SuggestionState,
  suggestionState,
  touchedPanelIds,
} from './critique'
import styles from './critique-panel.module.css'
import { errorMessage } from './route-error'
import { FailureAlert } from './sign-in'
import type { ProjectStore } from './store/project-store'

/** 相談した時点の診断の件数。適用後の診断と比べて減ったかを見せる */
interface Counts {
  issues: number
  miss: number
  weak: number
}

type Consultation =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'done'; response: CritiqueResponse; before: Counts }

/** 絵があるコマに提案を入れた記録。そのコマの絵が描き直されるか、提案が Undo で外れるまで再生成を促す */
interface Regenerate {
  panelId: ID
  artId: ID
  suggestion: number
}

interface CritiquePanelProps {
  store: ProjectStore
  page: Page
  pageId: ID
  /** ページの大きさ（mm）。フキダシを動かす提案を枠に収めるのに使う */
  pageSize: ProjectSettings['pageSize']
  diagnosis: PageDiagnosis
  llmProvider: LlmProvider
  canEdit: boolean
  generating: Set<ID>
  /** カードにホバーしている間、仮適用する Patch（ページ根）。離れると null */
  onPreview(patch: Patch | null): void
  onGenerate(panelId: ID): void
}

const counts = (diagnosis: PageDiagnosis): Counts => ({
  issues: diagnosis.issues.length,
  miss: diagnosis.summary.miss,
  weak: diagnosis.summary.weak,
})

/**
 * 「AI に相談」。ページと診断を LlmProvider.critique に送り、summary と提案のカードを出す。
 * カードにホバーかフォーカスすると onPreview で仮適用を渡し、「適用」で `source: 'ai'` の 1 手として入れる。
 * 許されない操作の提案は警告つきで適用できなくする。相談時と今の診断の件数を並べ、
 * 絵のあるコマに提案を入れたら、そのコマの再生成を促す。ページを替えるときは key で作り直す
 */
export function CritiquePanel(props: CritiquePanelProps) {
  const { store, page, pageId, diagnosis, llmProvider, canEdit, generating } = props
  const [consultation, setConsultation] = useState<Consultation>({ status: 'idle' })
  const [applyError, setApplyError] = useState<string>()
  const [regenerate, setRegenerate] = useState<Regenerate[]>([])
  const requestId = useRef(0)
  const onPreview = useRef(props.onPreview)
  onPreview.current = props.onPreview

  // ページを離れたら仮適用を消し、遅れて届いた応答を捨てる
  useEffect(
    () => () => {
      requestId.current++
      onPreview.current(null)
    },
    [],
  )

  const ask = async () => {
    const id = ++requestId.current
    const before = counts(diagnosis)
    setConsultation({ status: 'loading' })
    setApplyError(undefined)
    setRegenerate([])
    onPreview.current(null)
    try {
      const response = await llmProvider.critique(critiqueRequest(page, diagnosis))
      if (requestId.current === id) setConsultation({ status: 'done', response, before })
    } catch (e) {
      if (requestId.current === id) setConsultation({ status: 'error', error: e })
    }
  }

  const apply = (suggestion: Suggestion, index: number) => {
    try {
      const patch = applySuggestion(store, pageId, suggestion)
      onPreview.current(null)
      setApplyError(undefined)
      const drawn = touchedPanelIds(page, patch).flatMap((panelId) => {
        const artId = page.panels.find((p) => p.id === panelId)?.artId
        return artId === undefined ? [] : [{ panelId, artId, suggestion: index }]
      })
      setRegenerate((prev) => [...prev, ...drawn])
    } catch (e) {
      setApplyError(errorMessage(e))
    }
  }

  const loading = consultation.status === 'loading'
  return (
    <YStack as="section" className={styles.panel} data-critique={consultation.status}>
      <XStack wrap>
        <Button
          size="small"
          variant="primary"
          disabled={!canEdit || loading}
          onClick={() => void ask()}
        >
          {loading ? '相談中…' : consultation.status === 'done' ? 'もう一度相談' : 'AI に相談'}
        </Button>
      </XStack>
      {consultation.status === 'error' && (
        <FailureAlert failure="AI に相談できませんでした" error={consultation.error} />
      )}
      {consultation.status === 'done' && (
        <Result
          response={consultation.response}
          before={consultation.before}
          now={counts(diagnosis)}
          page={page}
          pageSize={props.pageSize}
          canEdit={canEdit}
          generating={generating}
          regenerate={regenerate}
          applyError={applyError}
          onPreview={(patch) => onPreview.current(patch)}
          onApply={apply}
          onGenerate={props.onGenerate}
          onDismiss={(panelId) =>
            setRegenerate((prev) => prev.filter((r) => r.panelId !== panelId))
          }
        />
      )}
    </YStack>
  )
}

function Result({
  response,
  before,
  now,
  page,
  pageSize,
  canEdit,
  generating,
  regenerate,
  applyError,
  onPreview,
  onApply,
  onGenerate,
  onDismiss,
}: {
  response: CritiqueResponse
  before: Counts
  now: Counts
  page: Page
  pageSize: ProjectSettings['pageSize']
  canEdit: boolean
  generating: Set<ID>
  regenerate: Regenerate[]
  applyError: string | undefined
  onPreview(patch: Patch | null): void
  onApply(suggestion: Suggestion, index: number): void
  onGenerate(panelId: ID): void
  onDismiss(panelId: ID): void
}) {
  const states = response.suggestions.map((s) => suggestionState(page, s, pageSize))
  const stale = [
    ...new Map(
      regenerate
        .filter((r) => {
          const panel = page.panels.find((p) => p.id === r.panelId)
          return panel?.artId === r.artId && states[r.suggestion]?.kind === 'applied'
        })
        .map((r) => [r.panelId, r] as const),
    ).values(),
  ]
  const changed =
    before.issues !== now.issues || before.miss !== now.miss || before.weak !== now.weak
  return (
    <>
      <Typography className={styles.summary} data-critique-summary>
        {response.summary}
      </Typography>
      {changed && (
        <Typography variant="caption" tone="muted" data-critique-delta>
          問題 {before.issues} → {now.issues} 件、miss {before.miss} → {now.miss}、weak{' '}
          {before.weak} → {now.weak}
        </Typography>
      )}
      {response.suggestions.length === 0 ? (
        <Typography tone="muted">提案はありません</Typography>
      ) : (
        <YStack as="ol" gap={6} className={styles.cards}>
          {response.suggestions.map((suggestion, i) => {
            const state: SuggestionState = states[i] ?? { kind: 'rejected', reason: '' }
            const preview = () => onPreview(state.kind === 'ready' ? state.patch : null)
            return (
              <YStack
                as="li"
                gap={6}
                // biome-ignore lint/suspicious/noArrayIndexKey: 提案の列は相談の応答ごとに固定で並び替わらず、同じ文言の提案も並びうる
                key={i}
                className={styles.card}
                data-suggestion={i}
                data-state={state.kind}
                onMouseEnter={preview}
                onMouseLeave={() => onPreview(null)}
                onFocus={preview}
                onBlur={() => onPreview(null)}
              >
                <Typography>{suggestion.message}</Typography>
                {state.kind === 'rejected' && (
                  <Typography variant="caption" tone="alert" role="alert">
                    {state.reason}
                  </Typography>
                )}
                <XStack wrap>
                  {state.kind === 'applied' ? (
                    <Typography as="span" variant="caption" tone="muted">
                      適用済み（Undo で戻せます）
                    </Typography>
                  ) : (
                    <Button
                      size="small"
                      disabled={!canEdit || state.kind === 'rejected'}
                      onClick={() => onApply(suggestion, i)}
                    >
                      適用
                    </Button>
                  )}
                </XStack>
              </YStack>
            )
          })}
        </YStack>
      )}
      {applyError && (
        <Typography tone="alert" role="alert">
          適用できませんでした: {applyError}
        </Typography>
      )}
      {stale.length > 0 && (
        <YStack as="ul" gap={6} className={styles.regenerate} data-critique-regenerate>
          {stale.map(({ panelId }) => {
            const order = page.panels.find((p) => p.id === panelId)?.order
            return (
              <XStack as="li" wrap key={panelId}>
                <span>コマ {order} の絵は提案前の配置で描かれています</span>
                <Button
                  size="small"
                  variant="primary"
                  disabled={!canEdit || generating.has(panelId)}
                  onClick={() => onGenerate(panelId)}
                >
                  再生成
                </Button>
                <Button size="small" variant="ghost" onClick={() => onDismiss(panelId)}>
                  閉じる
                </Button>
              </XStack>
            )
          })}
        </YStack>
      )}
    </>
  )
}
