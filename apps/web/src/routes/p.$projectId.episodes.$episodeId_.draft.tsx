import { m } from '@manga/i18n'
import type { PagePlan, PlanLine, Project } from '@manga/schema'
import {
  Button,
  Checkbox,
  IconButton,
  Input,
  TextArea,
  Typography,
  XStack,
  YStack,
} from '@manga/ui'
import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { BackLink } from '../back-link'
import common from '../common.module.css'
import { TemplateSelect, useTemplateChoice } from '../layout-templates'
import { LineEditor } from '../line-editor'
import { useTourStep } from '../onboarding/tour-guide'
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
 * （ページごとの流れ、脚本、登場キャラ、セリフ）を作り、全ページを並べて直せる形で見せる。脚本のセリフで
 * どのページにも入っていないものは一覧で知らせる。確かめた割り振りはテンプレート（登録したコマ割りも選べる）のページにし、
 * セリフはコマのフキダシにして、エピソードの末尾に `source: 'ai'` の 1 回の applyPatch で足す。
 * ページを離れると進行中の要求を abort し、後から届いた応答は捨てる。
 * オンボーディングの案内では、登録したキャラクターを話し手にした例の脚本を入れ、ページ数を 1 に決めておく
 */
function ScriptDraft() {
  const { projectId, episodeId } = Route.useParams()
  const { store } = projectRoute.useLoaderData()
  const { llmProvider } = Route.useRouteContext()
  const project = useProject(store)
  const navigate = useNavigate()
  const touring = useTourStep(projectId) === 'draft'
  const [script, setScript] = useState(() =>
    touring ? m.web_tour_script({ name: project.characters[0]?.name ?? m.untitled() }) : '',
  )
  const [pageCountText, setPageCountText] = useState(touring ? '1' : '')
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
    pageCount === null ? m.web_draft_page_count_error({ max: MAX_PAGE_COUNT }) : undefined
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
      if (!controller.signal.aborted) setPhase({ kind: 'failed', error: e })
    }
    if (running.current === controller) running.current = null
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
        label: m.web_draft_title(),
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
      <YStack as="header" gap={4} align="start">
        <BackLink to="/p/$projectId/episodes/$episodeId" params={{ projectId, episodeId }}>
          {episode?.title ?? m.web_draft_episode_fallback()}
        </BackLink>
        <Typography as="h1" variant="heading">
          {m.web_draft_title()}
        </Typography>
      </YStack>
      <div className={styles.layout} data-guide="draft-plan">
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
              label={m.web_draft_script()}
              hint={m.web_draft_script_hint()}
              className={styles.script}
              rows={16}
              value={script}
              onChange={(e) => setScript(e.target.value)}
            />
            <Input
              label={m.web_draft_page_count()}
              hint={m.web_draft_page_count_hint()}
              error={pageCountError}
              type="number"
              min={1}
              max={MAX_PAGE_COUNT}
              value={pageCountText}
              // 案内では 1 ページで足りる脚本を入れてあり、生成を待つ時間も短く済む
              disabled={touring}
              onChange={(e) => setPageCountText(e.target.value)}
            />
            <YStack gap={4}>
              <XStack wrap gap={8} role="group" aria-label={m.web_draft_page_count_guides()}>
                {PAGE_COUNT_GUIDES.map((g) => (
                  <Button
                    key={g.label}
                    size="small"
                    aria-pressed={g.pages === pageCount}
                    disabled={touring}
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
              label={m.web_draft_tone()}
              value={tone}
              placeholder={m.web_draft_tone_placeholder()}
              onChange={(e) => setTone(e.target.value)}
            />
          </YStack>
          <XStack wrap gap={8}>
            {isRunning ? (
              <Button onClick={stop}>{m.web_draft_stop()}</Button>
            ) : (
              <Button
                type="submit"
                variant={phase.kind === 'plan' ? 'secondary' : 'primary'}
                disabled={script.trim() === '' || pageCount === null}
              >
                {phase.kind === 'plan' ? m.web_draft_replan() : m.web_draft_plan()}
              </Button>
            )}
          </XStack>
          {isRunning && (
            <XStack as="p" className={styles.progress} role="status">
              {m.web_draft_planning()}
              <progress aria-label={m.web_draft_planning_progress()} />
            </XStack>
          )}
          {phase.kind === 'failed' && (
            <FailureAlert
              failure={m.web_draft_plan_failed()}
              error={phase.error}
              signInButton={false}
            />
          )}
        </YStack>
        <YStack as="section" gap={12} aria-label={m.web_draft_plan_section()}>
          {plans.length === 0 ? (
            <Typography tone="muted">{m.web_draft_empty()}</Typography>
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
                  {m.web_draft_summary({ pages: plans.length, lines: lineCount })}
                </Typography>
                <TemplateSelect project={project} value={template} onChange={setTemplate} />
                <Button type="submit" variant="primary" disabled={isRunning}>
                  {m.web_draft_add_pages({ count: plans.length })}
                </Button>
                <Button onClick={discard}>{m.web_draft_discard()}</Button>
              </XStack>
              {addError && (
                <Typography tone="alert" role="alert">
                  {addError}
                </Typography>
              )}
              {planned?.pageCount !== undefined && plans.length !== planned.pageCount && (
                <Typography tone="muted" role="status">
                  {m.web_draft_page_count_mismatch({
                    requested: planned.pageCount,
                    planned: plans.length,
                  })}
                </Typography>
              )}
              {missing.length > 0 && (
                <YStack gap={4} role="status" className={styles.missing} data-missing-lines>
                  <Typography weight="bold">
                    {m.web_draft_missing_lines({ count: missing.length })}
                  </Typography>
                  <ul className={styles.missingList}>
                    {missing.map((line, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: 同じセリフが脚本に何度も出ることがある
                      <li key={i}>{m.web_draft_missing_line({ line })}</li>
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

/** ページ割りの全ページを 1 行ずつ並べ、流れ、脚本、登場キャラ、セリフを直せるようにする */
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
              label={m.web_draft_flow()}
              rows={3}
              value={p.note}
              onChange={(e) => editPlan(index, () => ({ note: e.target.value }))}
            />
            <TextArea
              label={m.web_draft_page_script()}
              rows={4}
              value={p.script}
              onChange={(e) => editPlan(index, () => ({ script: e.target.value }))}
            />
            {characters.length > 0 && (
              <XStack
                as="fieldset"
                wrap
                gap={8}
                className={styles.fieldset}
                aria-label={m.page_cast()}
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
          <YStack
            gap={6}
            as="fieldset"
            className={styles.fieldset}
            aria-label={m.web_draft_page_lines()}
          >
            {p.lines.length === 0 && (
              <Typography variant="caption" tone="muted">
                {m.web_draft_no_lines()}
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
                        label={m.web_draft_line_to_previous_page()}
                        onClick={() => moveEdgeLine(index, -1)}
                      >
                        ↑
                      </IconButton>
                    )}
                    {j === p.lines.length - 1 && index < plans.length - 1 && (
                      <IconButton
                        size="small"
                        label={m.web_draft_line_to_next_page()}
                        onClick={() => moveEdgeLine(index, 1)}
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
              className={styles.addLine}
              onClick={() => editLines(index, (lines) => [...lines, { text: '', shape: 'normal' }])}
            >
              {m.web_draft_add_line()}
            </Button>
          </YStack>
        </li>
      ))}
    </ol>
  )
}
