import { BUBBLE_SHAPES } from '@manga/inspector'
import type { Character, PagePlan, PlanLine, Project } from '@manga/schema'
import {
  Button,
  Checkbox,
  IconButton,
  Input,
  Select,
  TextArea,
  Typography,
  XStack,
  YStack,
} from '@manga/ui'
import { createFileRoute, getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import common from '../common.module.css'
import { TemplateSelect, useTemplateChoice } from '../layout-templates'
import {
  abortable,
  MAX_PAGE_COUNT,
  missingLines,
  normalizePlan,
  PAGE_COUNT_GUIDES,
  parsePageCount,
  plannedPage,
  planRequest,
} from '../page-plan'
import { appendPagesPatch, resolveTemplate } from '../project-ops'
import { errorMessage } from '../route-error'
import { FailureAlert } from '../sign-in'
import { useProject } from '../use-project'
import styles from './script-draft.module.css'

export const Route = createFileRoute('/p/$projectId/episodes/$episodeId_/draft')({
  component: ScriptDraft,
})

const projectRoute = getRouteApi('/p/$projectId')

type Phase =
  | { kind: 'input' }
  | { kind: 'planning' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'plan' }

/**
 * 「脚本から下書き」のページ。脚本、ページ数、トーンから `llmProvider.planPages` でページ割り
 * （ページごとの流れ、登場キャラ、セリフ）を作り、全ページを並べて直せる形で見せる。脚本のセリフで
 * どのページにも入っていないものは一覧で知らせる。確かめた割り振りはテンプレート（登録したコマ割りも選べる）のページにし、
 * セリフはコマのフキダシにして、エピソードの末尾に `source: 'ai'` の 1 回の applyPatch で足す。
 * ページを離れると進行中の要求を abort し、後から届いた応答は捨てる
 */
function ScriptDraft() {
  const { projectId, episodeId } = Route.useParams()
  const { store } = projectRoute.useLoaderData()
  const { llmProvider } = Route.useRouteContext()
  const project = useProject(store)
  const navigate = useNavigate()
  const [script, setScript] = useState('')
  const [pageCountText, setPageCountText] = useState('')
  const [tone, setTone] = useState('')
  const [template, setTemplate] = useTemplateChoice(project)
  const [phase, setPhase] = useState<Phase>({ kind: 'input' })
  const [plans, setPlans] = useState<PagePlan[]>([])
  /** ページ割りを作ったときの脚本とページ数。後から脚本の欄を直しても、抜けの比べ先は変えない */
  const [planned, setPlanned] = useState<{ script: string; pageCount?: number }>()
  const [addError, setAddError] = useState<string>()
  const running = useRef<AbortController | null>(null)

  useEffect(() => () => running.current?.abort(), [])

  const episode = project.episodes.find((e) => e.id === episodeId)
  const backToEpisode = () =>
    navigate({ to: '/p/$projectId/episodes/$episodeId', params: { projectId, episodeId } })

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
      setPlanned({ script, pageCount })
      setPhase({ kind: 'plan' })
    } catch (e) {
      // 中止とページを離れたときは、そちらの操作が画面を決める
      if (controller.signal.aborted) return
      setPhase({ kind: 'failed', error: e })
    } finally {
      if (running.current === controller) running.current = null
    }
  }

  const stop = () => {
    running.current?.abort()
    setPhase(plans.length > 0 ? { kind: 'plan' } : { kind: 'input' })
  }

  const append = () => {
    try {
      const layout = resolveTemplate(project, template)
      const pages = plans.map((p) =>
        plannedPage(normalizePlan(p, project.characters), layout, project),
      )
      store.applyPatch(appendPagesPatch(store.get(), pages, episodeId), {
        source: 'ai',
        label: '脚本から下書き',
      })
      void backToEpisode()
    } catch (e) {
      setAddError(errorMessage(e))
    }
  }

  const discard = () => {
    setPlans([])
    setPlanned(undefined)
    setPhase({ kind: 'input' })
  }

  const isRunning = phase.kind === 'planning'
  const missing = planned ? missingLines(planned.script, plans) : []
  const lineCount = plans.reduce((n, p) => n + p.lines.length, 0)

  return (
    <YStack gap={12}>
      <XStack wrap gap={12}>
        <Link to="/p/$projectId/episodes/$episodeId" params={{ projectId, episodeId }}>
          {episode?.title ?? 'エピソード'}
        </Link>
        <Typography as="h1" variant="heading">
          脚本から下書き
        </Typography>
      </XStack>
      <div className={styles.layout}>
        <YStack
          as="form"
          gap={12}
          className={styles.inputs}
          onSubmit={(e) => {
            e.preventDefault()
            void plan()
          }}
        >
          <YStack as="fieldset" gap={12} className={styles.fieldset} disabled={isRunning}>
            <TextArea
              label="脚本"
              hint="セリフとト書きをそのまま貼り付けます"
              className={styles.script}
              rows={16}
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
            <Input
              label="ページ数"
              hint="この枚数に脚本を割り振ります。空なら脚本に合わせます"
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
          <XStack wrap gap={8}>
            {isRunning ? (
              <Button onClick={stop}>中止</Button>
            ) : (
              <Button
                type="submit"
                variant={phase.kind === 'plan' ? 'secondary' : 'primary'}
                disabled={script.trim() === '' || pageCount === null}
              >
                {phase.kind === 'plan' ? 'ページ割りを作り直す' : 'ページ割りを作る'}
              </Button>
            )}
          </XStack>
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
        </YStack>
        <YStack as="section" gap={12} aria-label="ページ割り">
          {plans.length === 0 ? (
            <Typography tone="muted">
              脚本を入れてページ割りを作ると、ここにページごとの流れ、登場キャラ、セリフが並びます
            </Typography>
          ) : (
            <>
              <XStack
                as="form"
                wrap
                gap={12}
                className={common.toolbar}
                onSubmit={(e) => {
                  e.preventDefault()
                  append()
                }}
              >
                <Typography>
                  {plans.length} ページ / セリフ {lineCount}
                </Typography>
                <TemplateSelect project={project} value={template} onChange={setTemplate} />
                <Button type="submit" variant="primary" disabled={isRunning}>
                  {plans.length} ページを追加
                </Button>
                <Button onClick={discard}>破棄</Button>
              </XStack>
              {addError && (
                <Typography tone="alert" role="alert">
                  {addError}
                </Typography>
              )}
              {planned?.pageCount !== undefined && plans.length !== planned.pageCount && (
                <Typography tone="muted" role="status">
                  {planned.pageCount} ページの指定に対して {plans.length}{' '}
                  ページの割り振りです。合わなければ作り直してください
                </Typography>
              )}
              {missing.length > 0 && (
                <YStack gap={4} role="status" className={styles.missing} data-missing-lines>
                  <Typography weight="bold">
                    脚本のセリフ {missing.length} 個がどのページにも入っていません
                  </Typography>
                  <ul className={styles.missingList}>
                    {missing.map((line, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 同じセリフが脚本に何度も出ることがある
                      <li key={i}>「{line}」</li>
                    ))}
                  </ul>
                </YStack>
              )}
              <PlanList plans={plans} characters={project.characters} onChange={setPlans} />
            </>
          )}
        </YStack>
      </div>
    </YStack>
  )
}

const CAST_LABEL = '登場キャラ'

/** ページ割りの全ページを 1 行ずつ並べ、流れ、登場キャラ、セリフを直せるようにする */
function PlanList({
  plans,
  characters,
  onChange,
}: {
  plans: PagePlan[]
  characters: Project['characters']
  onChange(update: (prev: PagePlan[]) => PagePlan[]): void
}) {
  const editPlan = (index: number, next: (p: PagePlan) => Partial<PagePlan>) =>
    onChange((prev) => prev.map((p, i) => (i === index ? { ...p, ...next(p) } : p)))
  const editLines = (index: number, next: (lines: PlanLine[]) => PlanLine[]) =>
    editPlan(index, (p) => ({ lines: next(p.lines) }))
  /** ページ index の先頭のセリフを前のページの末尾へ（by -1）、末尾のセリフを次のページの先頭へ（by 1）移す */
  const moveEdgeLine = (index: number, by: -1 | 1) =>
    onChange((prev) => {
      const from = prev[index]
      const to = prev[index + by]
      if (!from || !to || from.lines.length === 0) return prev
      const line = (by === -1 ? from.lines[0] : from.lines.at(-1)) as PlanLine
      return prev.map((p, i) => {
        if (i === index) return { ...p, lines: by === -1 ? p.lines.slice(1) : p.lines.slice(0, -1) }
        if (i === index + by)
          return { ...p, lines: by === -1 ? [...p.lines, line] : [line, ...p.lines] }
        return p
      })
    })

  return (
    <ol className={styles.plans}>
      {plans.map((p, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ページは並べ替えも増減もしない
        <li key={index} className={styles.plan} data-plan-page={index + 1}>
          <Typography weight="bold" className={styles.number}>
            {index + 1}
          </Typography>
          <YStack gap={8}>
            <TextArea
              label="流れ"
              rows={3}
              value={p.note}
              onChange={(e) => editPlan(index, () => ({ note: e.target.value }))}
            />
            {characters.length > 0 && (
              <XStack
                as="fieldset"
                wrap
                gap={8}
                className={styles.fieldset}
                aria-label={CAST_LABEL}
              >
                {characters.map((c) => (
                  <Checkbox
                    key={c.id}
                    label={c.name}
                    checked={p.cast.includes(c.id)}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked
                      editPlan(index, (cur) => ({
                        cast: checked
                          ? characters
                              .map((x) => x.id)
                              .filter((id) => id === c.id || cur.cast.includes(id))
                          : cur.cast.filter((id) => id !== c.id),
                      }))
                    }}
                  />
                ))}
              </XStack>
            )}
          </YStack>
          <YStack gap={6} as="fieldset" className={styles.fieldset} aria-label="このページのセリフ">
            {p.lines.length === 0 && (
              <Typography variant="caption" tone="muted">
                セリフなし
              </Typography>
            )}
            <ol className={styles.lines}>
              {p.lines.map((line, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: セリフに id が無く、入力中の欄は位置で追えば足りる
                <li key={j} className={styles.line} data-plan-line>
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
                        label="前のページへ"
                        onClick={() => moveEdgeLine(index, -1)}
                      >
                        ↑
                      </IconButton>
                    )}
                    {j === p.lines.length - 1 && index < plans.length - 1 && (
                      <IconButton
                        size="small"
                        label="次のページへ"
                        onClick={() => moveEdgeLine(index, 1)}
                      >
                        ↓
                      </IconButton>
                    )}
                    <IconButton
                      size="small"
                      label="セリフを削除"
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
              className={styles.addLine}
              onClick={() => editLines(index, (lines) => [...lines, { text: '', shape: 'normal' }])}
            >
              セリフを足す
            </Button>
          </YStack>
        </li>
      ))}
    </ol>
  )
}

/** セリフ 1 つの話し手、形、本文の欄 */
function LineEditor({
  line,
  characters,
  onChange,
}: {
  line: PlanLine
  characters: readonly Character[]
  onChange(next: PlanLine): void
}) {
  return (
    <XStack gap={4} className={styles.lineFields}>
      <Select
        label="話し手"
        hideLabel
        className={styles.lineSelect}
        value={line.speakerId ?? ''}
        onChange={(e) => {
          const { speakerId: _, ...rest } = line
          const id = e.currentTarget.value
          onChange(id === '' ? rest : { ...rest, speakerId: id })
        }}
      >
        <option value="">（なし）</option>
        {characters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select
        label="形"
        hideLabel
        className={styles.lineSelect}
        value={line.shape}
        onChange={(e) => onChange({ ...line, shape: e.currentTarget.value as PlanLine['shape'] })}
      >
        {BUBBLE_SHAPES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      <Input
        label="セリフ"
        hideLabel
        className={styles.lineText}
        value={line.text}
        onChange={(e) => onChange({ ...line, text: e.target.value })}
      />
    </XStack>
  )
}
