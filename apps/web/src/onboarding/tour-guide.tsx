import { m } from '@manga/i18n'
import type { ID } from '@manga/schema'
import { useParams, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useStore } from 'zustand'
import type { EditorArea } from '../page-editor'
import type { FileRoutesById } from '../routeTree.gen'
import { useOpenedProject } from '../settings-dialog'
import { Spotlight } from '../spotlight'
import type { WebProjectStore } from '../store/project-store'
import { useProject } from '../use-project'
import { stepIndex, TOUR_STEPS, type TourStep, tour } from './tour'

type RouteId = keyof FileRoutesById

interface Guide {
  /** 吹き出しを向ける要素のセレクタ */
  target: string
  message: () => string
  /** ぼかさずに見せたままにする要素のセレクタ */
  keep?: readonly string[]
}

const NO_KEEP: readonly string[] = []
// キャンバスは置いた要素と生成した絵を見せる所なので、他を指している間もぼかさない
const KEEP_CANVAS = ['[data-area="canvas"]']
const CANVAS = '[data-area="canvas"]'
const EDITOR: RouteId = '/p/$projectId_/pages/$pageId'

/** 手順ごとに、いる画面で吹き出しを向ける所。載っていない画面では案内しない */
const GUIDES: Record<TourStep, Partial<Record<RouteId, Guide>>> = {
  project: {
    '/new': { target: '[data-guide="new-project"]', message: m.web_tour_project },
  },
  character: {
    '/p/$projectId/': {
      target: '[data-guide="nav-characters"]',
      message: m.web_tour_character_open,
    },
    '/p/$projectId/characters': {
      target: '[data-guide="add-character"]',
      message: m.web_tour_character_add,
    },
    '/p/$projectId/characters_/new': {
      target: '[data-guide="character-form"]',
      message: m.web_tour_character_form,
    },
  },
  episode: {
    '/p/$projectId/characters': {
      target: '[data-guide="nav-episodes"]',
      message: m.web_tour_episode_open,
    },
    '/p/$projectId/': { target: '[data-guide="add-episode"]', message: m.web_tour_episode_add },
  },
  draft: {
    '/p/$projectId/episodes/$episodeId': {
      target: '[data-guide="draft"]',
      message: m.web_tour_draft_open,
    },
    '/p/$projectId/episodes/$episodeId_/draft': {
      target: '[data-guide="draft-plan"]',
      message: m.web_tour_draft,
    },
  },
  panels: {
    '/p/$projectId/episodes/$episodeId': {
      target: '[data-guide="page"]',
      message: m.web_tour_page_open,
    },
    [EDITOR]: { target: CANVAS, message: m.web_tour_panels },
  },
  bubbles: { [EDITOR]: { target: CANVAS, message: m.web_tour_bubbles } },
  hints: {
    [EDITOR]: { target: '[data-area="tools"]', message: m.web_tour_hints, keep: KEEP_CANVAS },
  },
  generate: {
    [EDITOR]: {
      target: '[data-action="generate-all"]',
      message: m.web_tour_generate,
      keep: KEEP_CANVAS,
    },
  },
  layers: {
    [EDITOR]: { target: '[data-area="layers"]', message: m.web_tour_layers, keep: KEEP_CANVAS },
  },
  export: {
    [EDITOR]: { target: '[data-guide="export"]', message: m.web_tour_export, keep: KEEP_CANVAS },
  },
  done: {
    [EDITOR]: {
      target: '[data-guide="nav-projects"]',
      message: m.web_tour_done,
      keep: KEEP_CANVAS,
    },
  },
}

/** 編集画面の手順ごとに使える領域。載っていない手順では全部使える */
const EDITOR_AREAS: Partial<Record<TourStep, ReadonlySet<EditorArea>>> = {
  panels: new Set(['canvas']),
  bubbles: new Set(['canvas']),
  hints: new Set(['canvas', 'tools']),
  generate: new Set(['generate']),
  layers: new Set(['layers']),
  export: new Set(['export']),
}

/** `projectId`（と `pageId`）が案内しているプロジェクト（とページ）なら、今の手順 */
export function useTourStep(projectId: ID, pageId?: ID): TourStep | undefined {
  const progress = useStore(tour.state)
  if (!progress || progress.projectId !== projectId) return undefined
  if (pageId !== undefined && progress.pageId !== pageId) return undefined
  return progress.step
}

/** 案内の手順で編集画面のうち使える領域。案内していなければ undefined で、全部使える */
export function tourEditorAreas(step: TourStep | undefined): ReadonlySet<EditorArea> | undefined {
  return step && EDITOR_AREAS[step]
}

/**
 * オンボーディングの案内。今の手順で押す所だけを残して画面をぼかし、吹き出しで指す。
 * 案内で作ったプロジェクトを開いている間はその中身を見て、終えた手順を次に進める。
 * 締めくくりのあとにプロジェクト一覧へ戻ったら案内を終える
 */
export function TourGuide() {
  const progress = useStore(tour.state)
  const routeId = useRouterState({ select: (s) => s.matches.at(-1)?.routeId })
  const { pageId } = useParams({ strict: false })
  const opened = useOpenedProject()
  const finished = progress?.step === 'done' && routeId === '/'
  useEffect(() => {
    if (finished) tour.finish()
  }, [finished])
  if (!progress || !routeId) return null
  const inProject = opened !== undefined && opened.projectId === progress.projectId
  const onPage = routeId !== EDITOR || pageId === progress.pageId
  const guide =
    progress.step === 'project' || (inProject && onPage)
      ? GUIDES[progress.step][routeId]
      : undefined
  return (
    <>
      {inProject && <Advance store={opened.store} />}
      {guide && (
        <Spotlight target={guide.target} keep={guide.keep ?? NO_KEEP}>
          {progress.step !== 'done' && (
            <strong>
              {m.web_tour_count({
                step: stepIndex(progress.step) + 1,
                total: TOUR_STEPS.length,
              })}{' '}
            </strong>
          )}
          {guide.message()}
        </Spotlight>
      )}
    </>
  )
}

function Advance({ store }: { store: WebProjectStore }) {
  const project = useProject(store)
  useEffect(() => tour.advance(project), [project])
  return null
}
