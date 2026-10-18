import { currentArt, type ID, type Page, type Project } from '@manga/schema'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { findPage } from '../project-ops'

/** オンボーディングの手順。作品を作る順に並び、前の手順を終えるまで次に進まない */
export const TOUR_STEPS = [
  'project',
  'character',
  'episode',
  'draft',
  'panels',
  'bubbles',
  'hints',
  'generate',
  'layers',
  'export',
] as const

/** 案内している手順。`done` は全部の手順を終えたあとの締めくくりで、手順の数に入れない */
export type TourStep = (typeof TOUR_STEPS)[number] | 'done'

/**
 * 案内の進み具合。`projectId` は案内の中で作ったプロジェクト、`pageId` は下書きで足したページ。
 * `baseline` はその手順に入ったときのページの様子で、そこから変われば手順を終えたとみなす
 */
interface TourProgress {
  step: TourStep
  projectId?: ID
  pageId?: ID
  baseline?: string
}

/** 編集画面で利用者がしたことのうち、Project に残らないので画面から知らせるもの */
type TourEvent = 'hints-hidden' | 'exported'

type TourStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface Tour {
  /** 案内していなければ null */
  readonly state: StoreApi<TourProgress | null>
  /** 案内を最初から始める */
  start(): void
  /**
   * 「はじめに」から開き直したときに、続きから案内できる形に直す。案内していない、または案内で作ったプロジェクトが
   * 消えていれば最初から、下書きまでの手順と下書きで足したページは `project` で確かめ直し、済んでいない手順から始め直す
   */
  resume(project: Project | undefined): void
  /** 案内の中でプロジェクトを作った */
  created(projectId: ID): void
  /** `project` を見て、終えた手順を先に進める */
  advance(project: Project): void
  report(event: TourEvent): void
  finish(): void
}

const STORAGE_KEY = 'manga.onboarding.tour'

const EVENTS: Partial<Record<TourStep, TourEvent>> = {
  layers: 'hints-hidden',
  export: 'exported',
}

const panelShapes = (page: Page) => JSON.stringify(page.panels.map((p) => [p.rect, p.shape]))

const bubbleShapes = (page: Page) =>
  JSON.stringify(page.panels.flatMap((p) => p.bubbles.map((b) => [b.id, b.pos, b.size, b.tail])))

const hintCounts = (page: Page) =>
  [
    page.panels.reduce((n, p) => n + p.focusPoints.length, 0),
    page.panels.reduce((n, p) => n + p.vectors.length, 0),
  ] as const

const SNAPSHOTS: Partial<Record<TourStep, (page: Page) => string>> = {
  panels: panelShapes,
  bubbles: bubbleShapes,
  hints: (page) => JSON.stringify(hintCounts(page)),
}

const draftPage = (project: Project) => project.episodes.find((e) => e.pages.length > 0)?.pages[0]

type Check = (project: Project, page: Page | undefined, baseline: string | undefined) => boolean

const DONE: Partial<Record<TourStep, Check>> = {
  character: (project) => project.characters.length > 0,
  episode: (project) => project.episodes.length > 0,
  draft: (project) => draftPage(project) !== undefined,
  panels: (_, page, baseline) => page !== undefined && panelShapes(page) !== baseline,
  bubbles: (_, page, baseline) => page !== undefined && bubbleShapes(page) !== baseline,
  hints: (_, page, baseline) => {
    if (!page || !baseline) return false
    const [focus, vectors] = JSON.parse(baseline) as [number, number]
    const [nowFocus, nowVectors] = hintCounts(page)
    return nowFocus > focus && nowVectors > vectors
  },
  // 失敗したコマが残る間は進めず、もう一度「このページを全部生成」を押してもらう
  generate: (_, page) =>
    page !== undefined &&
    page.panels.length > 0 &&
    page.panels.every((p) => currentArt(p) !== undefined),
}

/** 手順の並びでの位置。`done` は最後の手順の後ろ */
export const stepIndex = (step: TourStep): number =>
  step === 'done' ? TOUR_STEPS.length : TOUR_STEPS.indexOf(step)

const nextStep = (step: TourStep): TourStep => TOUR_STEPS[stepIndex(step) + 1] ?? 'done'

const isStep = (value: unknown): value is TourStep =>
  value === 'done' || TOUR_STEPS.some((step) => step === value)

function read(storage: TourStorage | undefined): TourProgress | null {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') as TourProgress | null
    return value && isStep(value.step) ? value : null
  } catch {
    return null
  }
}

// ストレージを塞いだブラウザでも案内はできるので、覚えられないまま進める。
// 最初の手順はまだ失う進み具合が無く、覚えると後で /new を開くたびに案内がフォーム以外を塞ぐので覚えない
function write(storage: TourStorage | undefined, value: TourProgress | null) {
  try {
    if (value && value.step !== 'project') storage?.setItem(STORAGE_KEY, JSON.stringify(value))
    else storage?.removeItem(STORAGE_KEY)
  } catch {}
}

function browserStorage(): TourStorage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** 進み具合を `storage` に覚えておき、ページを離れたり開き直したりしても同じ手順から案内する */
function createTour(storage: TourStorage | undefined = browserStorage()): Tour {
  const state = createStore<TourProgress | null>()(() => read(storage))
  state.subscribe((value) => write(storage, value))

  const enter = (step: TourStep, project: Project, pageId: ID | undefined): TourProgress => {
    const page = pageId ? findPage(project, pageId)?.page : undefined
    const baseline = page && SNAPSHOTS[step]?.(page)
    return {
      step,
      projectId: project.id,
      ...(pageId && { pageId }),
      ...(baseline !== undefined && { baseline }),
    }
  }

  const advance = (project: Project) => {
    const current = state.getState()
    if (!current || current.projectId !== project.id) return
    let progress = current
    for (;;) {
      const done = DONE[progress.step]
      const page = progress.pageId ? findPage(project, progress.pageId)?.page : undefined
      if (!done?.(project, page, progress.baseline)) break
      const pageId = progress.step === 'draft' ? draftPage(project)?.id : progress.pageId
      progress = enter(nextStep(progress.step), project, pageId)
    }
    if (progress !== current) state.setState(progress, true)
  }

  return {
    state,
    start: () => state.setState({ step: 'project' }, true),
    resume(project) {
      const current = state.getState()
      if (!current || current.step === 'project') return state.setState({ step: 'project' }, true)
      if (!project || project.id !== current.projectId)
        return state.setState({ step: 'project' }, true)
      // 下書きまでの手順は Project から確かめ直せる。保存前に閉じて消えた手順があれば、そこへ戻す
      const pageGone = !current.pageId || !findPage(project, current.pageId)
      if (stepIndex(current.step) <= stepIndex('draft') || pageGone)
        state.setState({ step: 'character', projectId: project.id }, true)
      advance(project)
    },
    created(projectId) {
      if (state.getState()?.step === 'project')
        state.setState({ step: 'character', projectId }, true)
    },
    advance,
    report(event) {
      const current = state.getState()
      if (!current || EVENTS[current.step] !== event) return
      const { baseline: _, ...rest } = current
      state.setState({ ...rest, step: nextStep(current.step) }, true)
    },
    finish: () => state.setState(null, true),
  }
}

export const tour = createTour()

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { createEmptyProject } = await import('@manga/schema')
  const { addCharacterPatch, addEpisodePatch, addPagePatch } = await import('../project-ops')

  const memoryStorage = (): TourStorage => {
    const items = new Map<string, string>()
    return {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
      removeItem: (key) => void items.delete(key),
    }
  }

  /** 下書きを足したところまで進めたプロジェクト */
  const drafted = () => {
    const project = createEmptyProject('案内')
    project.characters.push(addCharacterPatch({ name: 'ミナ', shortName: 'ミ' }).character)
    const { episode } = addEpisodePatch(project)
    episode.pages.push(addPagePatch(project, '3rows').page)
    project.episodes.push(episode)
    return project
  }

  const editPage = (project: Project, edit: (page: Page) => void): Project => {
    const next = structuredClone(project)
    const page = next.episodes[0]?.pages[0]
    if (!page) throw new Error('no page')
    edit(page)
    return next
  }

  test('作った順に、終えた手順の次へ進む', () => {
    const tour = createTour(memoryStorage())
    tour.start()
    const empty = createEmptyProject('案内')
    tour.created(empty.id)
    tour.advance(empty)
    expect(tour.state.getState()?.step).toBe('character')

    const project = { ...drafted(), id: empty.id }
    tour.advance(project)
    const pageId = project.episodes[0]?.pages[0]?.id
    expect(tour.state.getState()).toMatchObject({ step: 'panels', pageId })
  })

  describe('編集画面の手順', () => {
    const at = (step: TourStep, initial: Project) => {
      let project = initial
      const tour = createTour(memoryStorage())
      tour.start()
      tour.created(project.id)
      tour.advance(project)
      while (tour.state.getState()?.step !== step) {
        const current = tour.state.getState()
        if (current?.step === 'panels')
          project = editPage(project, (page) => {
            const panel = page.panels[0]
            if (panel) panel.rect = { ...panel.rect, x: panel.rect.x + 0.01 }
          })
        else throw new Error(`cannot get past ${current?.step}`)
        tour.advance(project)
      }
      return { tour, project }
    }

    test('コマを動かすまでコマ割りの手順に留まる', () => {
      const { tour, project } = at('panels', drafted())
      tour.advance(project)
      expect(tour.state.getState()?.step).toBe('panels')
      const moved = editPage(project, (page) => {
        const panel = page.panels[1]
        if (panel) panel.rect = { ...panel.rect, w: panel.rect.w / 2 }
      })
      tour.advance(moved)
      expect(tour.state.getState()?.step).toBe('bubbles')
    })

    test('焦点と誘導線は両方足すまで進まない', () => {
      const { tour, project } = at('bubbles', drafted())
      // フキダシの無いページはフキダシを足せば進む
      const withBubble = editPage(project, (page) => {
        page.panels[0]?.bubbles.push({
          id: 'bb_1',
          order: 1,
          text: 'あ',
          shape: 'normal',
          pos: { x: 0.5, y: 0.5 },
          size: { w: 0.1, h: 0.1 },
        })
      })
      tour.advance(withBubble)
      expect(tour.state.getState()?.step).toBe('hints')
      const withFocus = editPage(withBubble, (page) =>
        page.panels[0]?.focusPoints.push({
          id: 'fp_1',
          kind: 'face',
          label: '',
          pos: { x: 0.5, y: 0.5 },
          weight: 1,
        }),
      )
      tour.advance(withFocus)
      expect(tour.state.getState()?.step).toBe('hints')
      const withVector = editPage(withFocus, (page) =>
        page.panels[0]?.vectors.push({
          id: 'vc_1',
          kind: 'gaze',
          from: { x: 0, y: 0 },
          to: { x: 1, y: 1 },
          strength: 'strong',
        }),
      )
      tour.advance(withVector)
      expect(tour.state.getState()?.step).toBe('generate')
    })
  })

  test('レイヤーと書き出しは、その手順にいるときの知らせだけで進む', () => {
    const tour = createTour(memoryStorage())
    tour.state.setState({ step: 'layers', projectId: 'p', pageId: 'pg' })
    tour.report('exported')
    expect(tour.state.getState()?.step).toBe('layers')
    tour.report('hints-hidden')
    expect(tour.state.getState()?.step).toBe('export')
    tour.report('exported')
    expect(tour.state.getState()?.step).toBe('done')
  })

  test('プロジェクトを作ってからの進み具合を覚えておき、作り直した Tour でも同じ手順から始める', () => {
    const storage = memoryStorage()
    const first = createTour(storage)
    first.start()
    expect(createTour(storage).state.getState()).toBeNull()
    first.created('p')
    expect(createTour(storage).state.getState()).toEqual({ step: 'character', projectId: 'p' })
    first.finish()
    expect(createTour(storage).state.getState()).toBeNull()
  })

  test('開き直したとき、プロジェクトが消えていれば最初から、済んでいない手順があればそこから', () => {
    const tour = createTour(memoryStorage())
    const project = drafted()
    tour.state.setState({ step: 'generate', projectId: project.id, pageId: 'gone' })
    tour.resume(project)
    expect(tour.state.getState()).toMatchObject({ step: 'panels' })
    tour.state.setState({ step: 'draft', projectId: project.id })
    tour.resume({ ...project, episodes: [] })
    expect(tour.state.getState()).toEqual({ step: 'episode', projectId: project.id })
    tour.resume(undefined)
    expect(tour.state.getState()).toEqual({ step: 'project' })
  })
}
