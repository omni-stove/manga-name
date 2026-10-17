import { EditorCanvas, type Layers } from '@manga/editor-canvas'
import {
  fitPanelBubbles,
  type ID,
  type Page,
  type PagePlan,
  type PageTemplate,
  type Project,
} from '@manga/schema'
import { Button, Checkbox, Dialog, Input, TextArea, Typography, XStack, YStack } from '@manga/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  abortable,
  checkProposedPage,
  LAYOUT_CHUNK_SIZE,
  layoutChunks,
  layoutRequest,
  MAX_PAGE_COUNT,
  normalizePlan,
  pageWithNewIds,
  parsePageCount,
  plannedPage,
  planRequest,
  withPlan,
} from './layout-proposal'
import type { LlmProvider } from './llm-provider'
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
  | { kind: 'layout' }

/** コマ割りの 1 ページ分の進み具合 */
type Slot =
  | { status: 'pending' }
  | { status: 'running' }
  | { status: 'done'; page: Page }
  | { status: 'failed'; error: unknown }

/** コマ割りの要求を同時に出す数 */
const LAYOUT_CONCURRENCY = 3

const PREVIEW_LAYERS: Layers = {
  reference: false,
  art: false,
  scribble: true,
  hints: true,
  diagnosis: false,
}
const NO_GENERATING = new Set<ID>()
const ignore = () => {}
const noAsset = () => Promise.reject(new Error('提案に絵はありません'))

const isBusy = (slot: Slot) => slot.status === 'pending' || slot.status === 'running'

/**
 * 「脚本から下書き」のモーダル。2 段で進める。
 * 1. 脚本、ページ数、トーンから `llmProvider.planPages` でページ割り（ページごとの流れ、登場キャラ、脚本の抜き書き）を作り、
 *    編集できる形で見せる。ここで `template` のページに流れと登場キャラだけを入れて追加してもよい。
 * 2. 確かめた割り振りを LAYOUT_CHUNK_SIZE ページずつ `llmProvider.proposeLayout` に渡してコマ割りを作り、
 *    読み取り専用のキャンバスで見せる。失敗したまとまりだけ作り直せる。
 * どちらの追加も ID を振り直し、`episodeId` のエピソードの末尾に `source: 'ai'` の 1 回の applyPatch で足すので、
 * Undo 1 回で丸ごと戻る。parseProject を通らないページはエラーを出してチェックできない。
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
  /** 流れだけで追加するときのページのテンプレート */
  template: PageTemplate
  onClose(): void
}) {
  const [script, setScript] = useState('')
  const [pageCountText, setPageCountText] = useState('')
  const [tone, setTone] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'input' })
  const [plans, setPlans] = useState<PagePlan[]>([])
  const [rationale, setRationale] = useState('')
  const [requested, setRequested] = useState<number>()
  const [slots, setSlots] = useState<Slot[]>([])
  const [unchecked, setUnchecked] = useState<ReadonlySet<number>>(new Set())
  const [addError, setAddError] = useState<string>()
  const running = useRef<AbortController | null>(null)

  useEffect(() => () => running.current?.abort(), [])

  const pageCount = parsePageCount(pageCountText)
  const pageCountError =
    pageCount === null ? `1〜${MAX_PAGE_COUNT} の整数にしてください` : undefined
  const issues = useMemo(
    () =>
      slots.map((slot) =>
        slot.status === 'done' ? checkProposedPage(project, slot.page) : undefined,
      ),
    [project, slots],
  )
  const busy = slots.some(isBusy)
  const chosen = slots.flatMap((slot, i) =>
    slot.status === 'done' && issues[i] === undefined && !unchecked.has(i) ? [slot.page] : [],
  )

  const restart = () => {
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setAddError(undefined)
    return controller
  }

  const plan = async () => {
    if (script.trim() === '' || pageCount === null) return
    const controller = restart()
    setPhase({ kind: 'planning' })
    try {
      const req = planRequest(project, { script, tone, pageCount })
      const res = await abortable(() => llmProvider.planPages(req), controller.signal)
      setPlans(res.pages.map((p) => normalizePlan(p, project.characters)))
      setRationale(res.rationale)
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

  /** `starts` を先頭の添字とするまとまりのコマ割りを作る。ほかのページの結果は残す */
  const layout = (starts: number[]) => {
    const controller = restart()
    setPhase({ kind: 'layout' })
    const update = (start: number, slot: (i: number) => Slot) =>
      setSlots((prev) =>
        prev.map((s, i) => (i >= start && i < start + LAYOUT_CHUNK_SIZE ? slot(i) : s)),
      )
    for (const start of starts) update(start, () => ({ status: 'pending' }))
    const { pageSize } = project.settings
    const queue = [...starts]
    const worker = async () => {
      for (let start = queue.shift(); start !== undefined; start = queue.shift()) {
        const chunk = plans.slice(start, start + LAYOUT_CHUNK_SIZE)
        update(start, () => ({ status: 'running' }))
        try {
          const req = layoutRequest(project, chunk, tone, start + 1)
          const res = await abortable(() => llmProvider.proposeLayout(req), controller.signal)
          update(start, (i) => {
            const page = res.pages[i - start]
            const planned = chunk[i - start]
            if (!page || !planned) {
              return {
                status: 'failed',
                error: new Error('このページのコマ割りが返りませんでした'),
              }
            }
            const panels = page.panels.map((panel) => fitPanelBubbles(panel, pageSize))
            return { status: 'done', page: withPlan({ ...page, panels }, planned) }
          })
        } catch (e) {
          if (controller.signal.aborted) return
          update(start, () => ({ status: 'failed', error: e }))
        }
      }
    }
    void Promise.all(Array.from({ length: LAYOUT_CONCURRENCY }, worker)).finally(() => {
      if (running.current === controller) running.current = null
    })
  }

  const layoutAll = () => {
    setSlots(plans.map(() => ({ status: 'pending' })))
    setUnchecked(new Set())
    layout(layoutChunks(plans.length))
  }

  const retryFailed = () =>
    layout(
      layoutChunks(plans.length).filter((start) =>
        slots.slice(start, start + LAYOUT_CHUNK_SIZE).some((s) => s.status === 'failed'),
      ),
    )

  const stop = () => {
    running.current?.abort()
    setPhase({ kind: 'input' })
  }

  const close = () => {
    running.current?.abort()
    onClose()
  }

  const backToPlan = () => {
    running.current?.abort()
    setSlots([])
    setPhase({ kind: 'plan' })
  }

  const append = (pages: Page[], label: string) => {
    if (pages.length === 0) return
    try {
      store.applyPatch(appendPagesPatch(store.get(), pages.map(pageWithNewIds), episodeId), {
        source: 'ai',
        label,
      })
      onClose()
    } catch (e) {
      setAddError(errorMessage(e))
    }
  }

  const appendPlansOnly = () =>
    append(
      plans.map((p) => plannedPage(p, template, project.settings.direction)),
      '脚本から下書き（流れだけ）',
    )

  const editPlan = (index: number, next: Partial<PagePlan>) =>
    setPlans((prev) => prev.map((p, i) => (i === index ? { ...p, ...next } : p)))

  const toggle = (index: number, checked: boolean) => {
    const next = new Set(unchecked)
    if (checked) next.delete(index)
    else next.add(index)
    setUnchecked(next)
  }

  const addErrorView = addError && (
    <Typography tone="alert" role="alert">
      {addError}
    </Typography>
  )
  const rationaleView = (
    <YStack as="aside" gap={8} className={styles.rationale}>
      <Typography weight="bold">割り方の説明</Typography>
      <Typography>{rationale}</Typography>
    </YStack>
  )

  if (phase.kind === 'plan') {
    return (
      <Dialog
        title="脚本から下書き"
        onClose={close}
        onSubmit={layoutAll}
        actions={
          <>
            <Button onClick={() => setPhase({ kind: 'input' })}>脚本に戻る</Button>
            <Button onClick={close}>破棄</Button>
            <Button onClick={appendPlansOnly}>流れだけで {plans.length} ページを追加</Button>
            <Button type="submit" variant="primary">
              コマ割りを作る
            </Button>
          </>
        }
      >
        <Typography tone="muted">
          ページごとの流れと登場キャラを確かめ、必要なら直してからコマ割りに進みます
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
                <details>
                  <summary>このページの脚本</summary>
                  <TextArea
                    label="脚本"
                    hideLabel
                    className={styles.script}
                    rows={4}
                    value={p.script}
                    onChange={(e) => editPlan(index, { script: e.target.value })}
                  />
                </details>
              </YStack>
            ))}
          </ol>
          {rationaleView}
        </div>
        {addErrorView}
      </Dialog>
    )
  }

  if (phase.kind === 'layout') {
    const failed = slots.filter((s) => s.status === 'failed').length
    const invalid = issues.filter((issue) => issue !== undefined).length
    return (
      <Dialog
        title="脚本から下書き"
        onClose={close}
        onSubmit={() => append(chosen, '脚本から下書き')}
        actions={
          <>
            <Button onClick={backToPlan}>流れに戻る</Button>
            <Button onClick={close}>破棄</Button>
            {failed > 0 && !busy && <Button onClick={retryFailed}>失敗したページを作り直す</Button>}
            <Button type="submit" variant="primary" disabled={busy || chosen.length === 0}>
              {chosen.length} ページを追加
            </Button>
          </>
        }
      >
        {busy && (
          <XStack as="p" className={styles.progress} role="status">
            コマ割りを作っています（{slots.filter((s) => !isBusy(s)).length} / {slots.length}）
            <progress
              aria-label="コマ割りの進行"
              value={slots.filter((s) => !isBusy(s)).length}
              max={slots.length}
            />
          </XStack>
        )}
        <div className={styles.result}>
          <ol className={styles.pages}>
            {slots.map((slot, index) => {
              const issue = issues[index]
              const planned = plans[index]
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: 割り振りの添字と 1 対 1 で、並べ替えない
                <YStack as="li" gap={6} key={index} data-proposal-page={index + 1}>
                  {slot.status === 'done' ? (
                    <>
                      <Checkbox
                        label={`${index + 1} ページ（コマ ${slot.page.panels.length}）`}
                        checked={issue === undefined && !unchecked.has(index)}
                        disabled={issue !== undefined}
                        onChange={(e) => toggle(index, e.currentTarget.checked)}
                      />
                      <div
                        className={styles.preview}
                        style={{
                          aspectRatio: `${project.settings.pageSize.w} / ${project.settings.pageSize.h}`,
                        }}
                        inert
                      >
                        <EditorCanvas
                          page={slot.page}
                          settings={project.settings}
                          characters={project.characters}
                          diagnosis={null}
                          selection={null}
                          tool="select"
                          layers={PREVIEW_LAYERS}
                          generating={NO_GENERATING}
                          onChange={ignore}
                          onSelect={ignore}
                          resolveAsset={noAsset}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <Typography>{index + 1} ページ</Typography>
                      {slot.status === 'failed' ? (
                        <FailureAlert
                          failure="コマ割りを作れませんでした"
                          error={slot.error}
                          signInButton={false}
                        />
                      ) : (
                        <Typography tone="muted" className={styles.waiting}>
                          {slot.status === 'running' ? '作っています…' : '待っています'}
                        </Typography>
                      )}
                    </>
                  )}
                  {planned && (
                    <Typography variant="caption" className={styles.note}>
                      {planned.note}
                    </Typography>
                  )}
                  {issue !== undefined && (
                    <Typography
                      variant="caption"
                      tone="alert"
                      className={styles.issue}
                      role="alert"
                    >
                      スキーマを通らないため追加できません。
                      {'\n'}
                      {issue}
                    </Typography>
                  )}
                </YStack>
              )
            })}
          </ol>
          {rationaleView}
        </div>
        {invalid > 0 && (
          <Typography tone="muted">
            {invalid} ページはキャラクターや参照が合わないため追加できません
          </Typography>
        )}
        {addErrorView}
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
