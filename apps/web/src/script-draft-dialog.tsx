import { EditorCanvas, type Layers } from '@manga/editor-canvas'
import type { ID, Page, Project } from '@manga/schema'
import { Button, Checkbox, Dialog, Field, Input, TextArea } from '@manga/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import common from './common.module.css'
import {
  checkProposedPage,
  MAX_PAGE_COUNT,
  pageWithNewIds,
  parsePageCount,
  proposalRequest,
  requestProposal,
} from './layout-proposal'
import type { LlmProvider } from './llm-provider'
import { appendPagesPatch } from './project-ops'
import { errorMessage } from './route-error'
import styles from './script-draft-dialog.module.css'
import type { ProjectStore } from './store/project-store'

type Phase =
  | { kind: 'input' }
  | { kind: 'running' }
  | { kind: 'failed'; message: string }
  | { kind: 'result'; pages: Page[]; rationale: string }

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

/**
 * 「脚本から下書き」のモーダル。脚本、ページ数の目安、トーンから `llmProvider.proposeLayout` でページ案を作り、
 * 読み取り専用のキャンバスと rationale で見せる。チェックしたページの ID を振り直し、`episodeId` のエピソードの
 * 末尾に `source: 'ai'` の 1 回の applyPatch で足すので、Undo 1 回で丸ごと戻る。
 * parseProject を通らないページはエラーを出してチェックできない。
 * 開いている間だけマウントする。閉じると進行中の要求を abort し、後から届いた応答は捨てる
 */
export function ScriptDraftDialog({
  project,
  store,
  llmProvider,
  episodeId,
  onClose,
}: {
  project: Project
  store: ProjectStore
  llmProvider: LlmProvider
  /** 追加先。省くと最後のエピソード、エピソードが無ければ 1 話目を作る */
  episodeId?: ID
  onClose(): void
}) {
  const [script, setScript] = useState('')
  const [pageCountText, setPageCountText] = useState('')
  const [tone, setTone] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'input' })
  const [unchecked, setUnchecked] = useState<ReadonlySet<number>>(new Set())
  const [addError, setAddError] = useState<string>()
  const running = useRef<AbortController | null>(null)

  useEffect(() => () => running.current?.abort(), [])

  const pageCount = parsePageCount(pageCountText)
  const pageCountError =
    pageCount === null ? `1〜${MAX_PAGE_COUNT} の整数にしてください` : undefined
  const resultPages = phase.kind === 'result' ? phase.pages : null
  const issues = useMemo(
    () => resultPages?.map((page) => checkProposedPage(project, page)) ?? [],
    [project, resultPages],
  )
  const chosen = resultPages?.filter((_, i) => issues[i] === undefined && !unchecked.has(i)) ?? []

  const propose = async () => {
    if (script.trim() === '' || pageCount === null) return
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setPhase({ kind: 'running' })
    setUnchecked(new Set())
    setAddError(undefined)
    try {
      const req = proposalRequest(project, { script, tone, pageCount })
      const res = await requestProposal(llmProvider, req, controller.signal)
      setPhase({ kind: 'result', pages: res.pages, rationale: res.rationale })
    } catch (e) {
      // 中止とモーダルを閉じたときは、そちらの操作が画面を決める
      if (controller.signal.aborted) return
      setPhase({ kind: 'failed', message: errorMessage(e) })
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

  const add = () => {
    if (chosen.length === 0) return
    try {
      const pages = chosen.map(pageWithNewIds)
      store.applyPatch(appendPagesPatch(store.get(), pages, episodeId), {
        source: 'ai',
        label: '脚本から下書き',
      })
      onClose()
    } catch (e) {
      setAddError(errorMessage(e))
    }
  }

  const toggle = (index: number, checked: boolean) => {
    const next = new Set(unchecked)
    if (checked) next.delete(index)
    else next.add(index)
    setUnchecked(next)
  }

  if (phase.kind === 'result') {
    const failed = issues.filter((issue) => issue !== undefined).length
    return (
      <Dialog
        title="脚本から下書き"
        onClose={close}
        onSubmit={add}
        actions={
          <>
            <Button onClick={() => setPhase({ kind: 'input' })}>脚本に戻る</Button>
            <Button onClick={close}>破棄</Button>
            <Button type="submit" variant="primary" disabled={chosen.length === 0}>
              {chosen.length} ページを追加
            </Button>
          </>
        }
      >
        <div className={styles.result}>
          <ol className={styles.pages}>
            {phase.pages.map((page, index) => {
              const issue = issues[index]
              return (
                <li key={page.id} className={styles.page} data-proposal-page={index + 1}>
                  <Checkbox
                    label={`${index + 1} ページ（コマ ${page.panels.length}）`}
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
                      page={page}
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
                  {issue !== undefined && (
                    <p className={`${common.error} ${styles.issue}`} role="alert">
                      スキーマを通らないため追加できません。
                      {'\n'}
                      {issue}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
          <aside className={styles.rationale}>
            <h3 className={styles.rationaleTitle}>割り方の説明</h3>
            <p>{phase.rationale}</p>
          </aside>
        </div>
        {phase.pages.length === 0 && (
          <p className={common.placeholder}>提案にページがありません</p>
        )}
        {failed > 0 && (
          <p className={common.placeholder}>
            {failed} ページはキャラクターや参照が合わないため追加できません
          </p>
        )}
        {addError && (
          <p className={common.error} role="alert">
            {addError}
          </p>
        )}
      </Dialog>
    )
  }

  const isRunning = phase.kind === 'running'
  return (
    <Dialog
      title="脚本から下書き"
      onClose={close}
      onSubmit={() => void propose()}
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
              提案を作る
            </Button>
          )}
        </>
      }
    >
      <fieldset className={styles.inputs} disabled={isRunning}>
        <Field label="脚本" hint="セリフとト書きをそのまま貼り付けます">
          <TextArea
            className={styles.script}
            rows={10}
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
        </Field>
        <Field label="ページ数の目安" hint="空なら脚本に合わせます" error={pageCountError}>
          <Input
            type="number"
            min={1}
            max={MAX_PAGE_COUNT}
            value={pageCountText}
            onChange={(e) => setPageCountText(e.target.value)}
          />
        </Field>
        <Field label="トーンのヒント">
          <Input
            value={tone}
            placeholder="例: 静かで寂しい"
            onChange={(e) => setTone(e.target.value)}
          />
        </Field>
      </fieldset>
      {isRunning && (
        <p className={styles.progress} role="status">
          提案を作っています…
          <progress aria-label="提案の進行" />
        </p>
      )}
      {phase.kind === 'failed' && (
        <p className={common.error} role="alert">
          提案を作れませんでした: {phase.message}
        </p>
      )}
    </Dialog>
  )
}
