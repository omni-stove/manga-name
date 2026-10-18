import type { ID, PagePlan, PageTemplate, Project } from '@manga/schema'
import { Button, Checkbox, Dialog, Input, TextArea, Typography, XStack, YStack } from '@manga/ui'
import { useEffect, useRef, useState } from 'react'
import type { LlmProvider } from './llm-provider'
import {
  abortable,
  MAX_PAGE_COUNT,
  normalizePlan,
  PAGE_COUNT_GUIDES,
  parsePageCount,
  plannedPage,
  planRequest,
} from './page-plan'
import { appendPagesPatch } from './project-ops'
import { errorMessage } from './route-error'
import styles from './script-draft-dialog.module.css'
import { FailureAlert } from './sign-in'
import type { ProjectStore } from './store/project-store'

type Phase =
  | { kind: 'input' }
  | { kind: 'planning' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'plan' }

/**
 * 「脚本から下書き」のモーダル。脚本、ページ数、トーンから `llmProvider.planPages` でページ割り
 * （ページごとの流れと登場キャラ）を作り、編集できる形で見せる。確かめた割り振りは `template` のページに入れ、
 * `episodeId` のエピソードの末尾に `source: 'ai'` の 1 回の applyPatch で足すので、Undo 1 回で丸ごと戻る。
 * 開いている間だけマウントする。閉じると進行中の要求を abort し、後から届いた応答は捨てる
 */
export function ScriptDraftDialog({
  project,
  store,
  llmProvider,
  episodeId,
  template,
  onClose,
}: {
  project: Project
  store: ProjectStore
  llmProvider: LlmProvider
  /** 追加先。省くと最後のエピソード、エピソードが無ければ 1 話目を作る */
  episodeId?: ID
  /** 追加するページのテンプレート */
  template: PageTemplate
  onClose(): void
}) {
  const [script, setScript] = useState('')
  const [pageCountText, setPageCountText] = useState('')
  const [tone, setTone] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'input' })
  const [plans, setPlans] = useState<PagePlan[]>([])
  const [requested, setRequested] = useState<number>()
  const [addError, setAddError] = useState<string>()
  const running = useRef<AbortController | null>(null)

  useEffect(() => () => running.current?.abort(), [])

  const pageCount = parsePageCount(pageCountText)
  const pageCountError =
    pageCount === null ? `1〜${MAX_PAGE_COUNT} の整数にしてください` : undefined
  const pageCountGuide = PAGE_COUNT_GUIDES.find((g) => g.pages === pageCount)

  const plan = async () => {
    if (script.trim() === '' || pageCount === null) return
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setAddError(undefined)
    setPhase({ kind: 'planning' })
    try {
      const req = planRequest(project, { script, tone, pageCount })
      const res = await abortable(() => llmProvider.planPages(req), controller.signal)
      setPlans(res.map((p) => normalizePlan(p, project.characters)))
      setRequested(pageCount)
      setPhase({ kind: 'plan' })
    } catch (e) {
      // 中止とモーダルを閉じたときは、そちらの操作が画面を決める
      if (controller.signal.aborted) return
      setPhase({ kind: 'failed', error: e })
    } finally {
      if (running.current === controller) running.current = null
    }
  }

  const stop = () => {
    running.current?.abort()
    setPhase({ kind: 'input' })
  }

  const close = () => {
    running.current?.abort()
    onClose()
  }

  const append = () => {
    const pages = plans.map((p) => plannedPage(p, template, project.settings.direction))
    try {
      store.applyPatch(appendPagesPatch(store.get(), pages, episodeId), {
        source: 'ai',
        label: '脚本から下書き',
      })
      onClose()
    } catch (e) {
      setAddError(errorMessage(e))
    }
  }

  const editPlan = (index: number, next: Partial<PagePlan>) =>
    setPlans((prev) => prev.map((p, i) => (i === index ? { ...p, ...next } : p)))

  if (phase.kind === 'plan') {
    return (
      <Dialog
        title="脚本から下書き"
        onClose={close}
        onSubmit={append}
        actions={
          <>
            <Button onClick={() => setPhase({ kind: 'input' })}>脚本に戻る</Button>
            <Button onClick={close}>破棄</Button>
            <Button type="submit" variant="primary">
              {plans.length} ページを追加
            </Button>
          </>
        }
      >
        <Typography tone="muted">
          ページごとの流れと登場キャラを確かめ、必要なら直してから追加します
        </Typography>
        {requested !== undefined && plans.length !== requested && (
          <Typography tone="muted" role="status">
            {requested} ページの指定に対して {plans.length}{' '}
            ページの割り振りです。合わなければ脚本に戻って作り直してください
          </Typography>
        )}
        <div className={styles.result}>
          <ol className={styles.plans}>
            {plans.map((p, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 割り振りは並べ替えも増減もしない
              <YStack as="li" gap={6} key={index} data-plan-page={index + 1}>
                <Typography weight="bold">{index + 1} ページ</Typography>
                <TextArea
                  label="流れ"
                  rows={2}
                  value={p.note}
                  onChange={(e) => editPlan(index, { note: e.target.value })}
                />
                {project.characters.length > 0 && (
                  <XStack
                    as="fieldset"
                    wrap
                    gap={8}
                    className={styles.cast}
                    aria-label="登場キャラ"
                  >
                    {project.characters.map((c) => (
                      <Checkbox
                        key={c.id}
                        label={c.name}
                        checked={p.cast.includes(c.id)}
                        onChange={(e) =>
                          editPlan(index, {
                            cast: e.currentTarget.checked
                              ? project.characters
                                  .map((x) => x.id)
                                  .filter((id) => id === c.id || p.cast.includes(id))
                              : p.cast.filter((id) => id !== c.id),
                          })
                        }
                      />
                    ))}
                  </XStack>
                )}
              </YStack>
            ))}
          </ol>
        </div>
        {addError && (
          <Typography tone="alert" role="alert">
            {addError}
          </Typography>
        )}
      </Dialog>
    )
  }

  const isRunning = phase.kind === 'planning'
  return (
    <Dialog
      title="脚本から下書き"
      onClose={close}
      onSubmit={() => void plan()}
      actions={
        <>
          <Button onClick={close}>キャンセル</Button>
          {isRunning ? (
            <Button onClick={stop}>中止</Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              disabled={script.trim() === '' || pageCount === null}
            >
              ページ割りを作る
            </Button>
          )}
        </>
      }
    >
      <YStack as="fieldset" gap={12} className={styles.inputs} disabled={isRunning}>
        <TextArea
          label="脚本"
          hint="セリフとト書きをそのまま貼り付けます"
          className={styles.script}
          rows={10}
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />
        <Input
          label="ページ数"
          hint="この枚数に脚本を割り振り、ページごとの流れと登場キャラを出します。空なら脚本に合わせます"
          error={pageCountError}
          type="number"
          min={1}
          max={MAX_PAGE_COUNT}
          value={pageCountText}
          onChange={(e) => setPageCountText(e.target.value)}
        />
        <YStack gap={4}>
          <XStack wrap gap={8} role="group" aria-label="商業誌の目安">
            {PAGE_COUNT_GUIDES.map((g) => (
              <Button
                key={g.label}
                size="small"
                aria-pressed={g.pages === pageCount}
                onClick={() => setPageCountText(String(g.pages))}
              >
                {g.label} {g.pages}
              </Button>
            ))}
          </XStack>
          {pageCountGuide && (
            <Typography variant="caption" tone="muted">
              {pageCountGuide.hint}
            </Typography>
          )}
        </YStack>
        <Input
          label="トーンのヒント"
          value={tone}
          placeholder="例: 静かで寂しい"
          onChange={(e) => setTone(e.target.value)}
        />
      </YStack>
      {isRunning && (
        <XStack as="p" className={styles.progress} role="status">
          ページ割りを作っています…
          <progress aria-label="ページ割りの進行" />
        </XStack>
      )}
      {phase.kind === 'failed' && (
        <FailureAlert
          failure="ページ割りを作れませんでした"
          error={phase.error}
          signInButton={false}
        />
      )}
    </Dialog>
  )
}
