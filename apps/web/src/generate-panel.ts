import type { ImageProvider, PageArtRequest, PanelArtRequest } from '@manga/ai'
import { diagnosePage, panelHint } from '@manga/diagnosis'
import { cropPanelArts, renderLayoutPng, renderPageLayoutPng } from '@manga/render'
import {
  type Character,
  currentArt,
  type ID,
  newId,
  type Page,
  type Panel,
  type PanelArt,
  type Patch,
  type Project,
  type ProjectSettings,
  pageCharacterIds,
  panelCharacterIds,
  type ReferenceImage,
} from '@manga/schema'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { findPanel, panelPatch } from './inspector-ops'
import type { ProjectLibrary } from './project-library'
import { findPage } from './project-ops'
import { cropReference } from './reference-image'
import { errorMessage } from './route-error'
import { needsSignIn } from './sign-in'
import type { ProjectStore } from './store/project-store'
import { toasts } from './toasts'

interface GeneratingState {
  /** 生成中のコマ。import で同じ JSON を読むとコマの id が重なるので、projectId とのキーで持つ。`generatingPanels` で取り出す */
  panels: Set<string>
  /** 一括生成が走っている範囲。キーは panels と同じく projectId との組で、`batchRunning` で引く */
  batches: Set<string>
}

const generatingKey = (projectId: ID, id: string) => `${projectId}/${id}`

/** プロジェクト 1 つ分の生成中のコマの id。EditorCanvas と Inspector にそのまま渡す */
export function generatingPanels(state: GeneratingState, projectId: ID): Set<ID> {
  const prefix = `${projectId}/`
  return new Set(
    [...state.panels].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
  )
}

/** 参考画像やヒントを使わないコマ。キーは generatingKey と同じ形 */
interface OptOutState {
  panels: Set<string>
}

/** コマの生成に参考画像を渡すか。既定は渡す */
export function usesReference(state: OptOutState, projectId: ID, panelId: ID): boolean {
  return !state.panels.has(generatingKey(projectId, panelId))
}

/** コマの生成に診断のヒントを渡すか。既定は渡す */
export function usesHint(state: OptOutState, projectId: ID, panelId: ID): boolean {
  return usesReference(state, projectId, panelId)
}

/** 一括生成の範囲が走っているか。`scope` は `generateAll` に渡したもの */
export function batchRunning(state: GeneratingState, projectId: ID, scope: string): boolean {
  return state.batches.has(generatingKey(projectId, scope))
}

interface GenerateRequest {
  store: ProjectStore
  projectId: ID
  pageId: ID
  panelId: ID
  /** 採用中の絵への修正指示。あれば再生成として `previous` と `parentId` を付ける */
  instruction?: string
  /** 中止されたら残りの手順を止め、後から届いた応答は捨てる */
  signal?: AbortSignal
}

/**
 * `busy` は同じコマが生成中で何もしなかった。`failed` は通知を出して Patch を入れなかった。
 * `canceled` は signal で中止され、通知も Patch も出さなかった
 */
type GenerateOutcome = 'done' | 'busy' | 'failed' | 'canceled'

interface BatchRequest {
  store: ProjectStore
  projectId: ID
  /** 走っている一括生成を見分けるキー。`page/<id>` や `episode/<id>`。同じ範囲の二重起動は断る */
  scope: string
  /** 対象のページ。並びの順に 1 ページ 1 回で生成する */
  pageIds: readonly ID[]
  /** false なら絵の無いコマだけに絵を入れ、絵の無いコマが無いページは呼ばない */
  includeGenerated: boolean
}

interface PageRunRequest {
  store: ProjectStore
  projectId: ID
  pageId: ID
  /** 生成したページから絵を入れるコマ */
  panelIds: readonly ID[]
  signal: AbortSignal
}

/** 範囲がすでに走っていれば `busy`。それ以外はコマごとの結果の件数 */
type BatchOutcome = 'busy' | Record<GenerateOutcome, number>

export interface PanelGeneration {
  readonly generating: StoreApi<GeneratingState>
  /** コマごとの「参考画像を使う」のオフ。データモデルに項目が無いので、開いている間だけ持つ */
  readonly referenceOptOut: StoreApi<OptOutState>
  setUseReference(projectId: ID, panelId: ID, use: boolean): void
  /** コマごとの「ヒントを使う」のオフ。referenceOptOut と同じく開いている間だけ持つ */
  readonly hintOptOut: StoreApi<OptOutState>
  setUseHint(projectId: ID, panelId: ID, use: boolean): void
  generate(req: GenerateRequest): Promise<GenerateOutcome>
  /**
   * 範囲のページを 1 ページ 1 回の呼び出しで生成し、コマごとに切り抜いて入れる。同時 `batchConcurrency` ページ。
   * 失敗はまとめて 1 回通知する
   */
  generateAll(req: BatchRequest): Promise<BatchOutcome>
  /** 走っている一括生成を止める。生成中のコマの応答は捨て、まだのコマは始めない */
  cancel(projectId: ID, scope: string): void
}

export interface PanelGenerationDeps {
  library: Pick<ProjectLibrary, 'isOpen' | 'loadAsset' | 'putAsset'>
  imageProvider: Pick<ImageProvider, 'generatePanelArt' | 'generatePageArt'>
  /** 失敗の文言の出し先。既定はトースト。signIn は未ログインのせいで失敗したことを表す */
  notify?(message: string, opts: { signIn: boolean }): void
  now?(): string
  /** ImageProvider に渡す配置図の長辺 px。コマでもページでも同じ。既定 1024 */
  layoutLongSide?: number
  /** 一括生成で同時に生成するページ数。既定 3 */
  batchConcurrency?: number
  /** 参考画像からコマの範囲を切り抜く。既定は canvas で描く `cropReference` */
  cropReference?: typeof cropReference
}

/** コマに登場するキャラ。順は panelCharacterIds */
function panelCharacters(panel: Panel, characters: readonly Character[]): Character[] {
  return panelCharacterIds(panel).flatMap((id) => characters.filter((c) => c.id === id))
}

/** コマの実寸の縦横比で、長辺を `longSide` にしたときの幅 */
function layoutWidth(panel: Panel, settings: ProjectSettings, longSide: number): number {
  const { pageSize } = settings
  const aspect = (panel.rect.h * pageSize.h) / (panel.rect.w * pageSize.w)
  return Math.round(aspect > 1 ? longSide / aspect : longSide)
}

/** 判型の縦横比で、長辺を `longSide` にしたときの幅 */
function pageLayoutWidth(settings: ProjectSettings, longSide: number): number {
  const aspect = settings.pageSize.h / settings.pageSize.w
  return Math.round(aspect > 1 ? longSide / aspect : longSide)
}

/**
 * ページに登場するキャラ。出るコマの多い順で、同数なら pageCharacterIds の順。
 * プロバイダが参照画像の枚数で切るとき（Gemini はキャラ 4 枚まで）に、よく出るキャラを残すため
 */
function pageCharacters(page: Page, characters: readonly Character[]): Character[] {
  const panels = new Map<ID, number>()
  for (const id of page.panels.flatMap(panelCharacterIds)) panels.set(id, (panels.get(id) ?? 0) + 1)
  return pageCharacterIds(page)
    .flatMap((id) => characters.filter((c) => c.id === id))
    .toSorted((a, b) => (panels.get(b.id) ?? 0) - (panels.get(a.id) ?? 0))
}

/** 診断の panelHint。ヒントが空なら undefined */
function hintFor(page: Page, panel: Panel, settings: ProjectSettings): string | undefined {
  const diagnosis = diagnosePage(page, settings).panels.find((d) => d.panelId === panel.id)
  const hint = diagnosis ? panelHint(panel, diagnosis) : ''
  return hint === '' ? undefined : hint
}

/** ImageProvider は signal を受け取らないので、中止されたら応答を待たずに捨てる */
function abortable<T>(start: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return start()
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    start()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/** `limit` 本の作業者で `items` を先頭から順に処理する */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T
      await task(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** 生成結果を `arts` に積んで採用する Patch。親の絵が生成中に消えていれば `parentId` を外す */
function addArtPatch(project: Project, pageId: ID, panelId: ID, art: PanelArt): Patch {
  const page = findPage(project, pageId)?.page
  const panel = page && findPanel(page, panelId)?.panel
  if (!panel) throw new Error('生成中にコマが消えました')
  const { parentId, ...orphan } = art
  const value = parentId !== undefined && panel.arts.some((a) => a.id === parentId) ? art : orphan
  return panelPatch(project, pageId, panelId, [
    { op: 'add', path: '/arts/-', value },
    { op: panel.artId === undefined ? 'add' : 'replace', path: '/artId', value: art.id },
  ])
}

/**
 * 02-architecture.md のデータフロー「生成」をまとめる。`generate` は 1 コマ分で、
 * 配置図 → 参考画像の切り抜き → 登場キャラの参照画像 → 前回の絵（修正指示つきのとき）→ 診断のヒント → ImageProvider → putAsset → applyPatch(ai)。
 * `generateAll` はページごとに、ページ全体を 1 回で生成してコマごとに切り抜く（`runPage`）。
 * 生成は store の外で進め、結果だけを Patch で入れるので Undo で生成前に戻せる。アセットは残る。
 * 進行中のコマは `generating` に持ち、画面を離れても生き続ける。同じコマの二重起動は `busy` で断る
 */
export function createPanelGeneration(deps: PanelGenerationDeps): PanelGeneration {
  const {
    library,
    imageProvider,
    notify = (message, opts) => toasts.push(message, 'error', opts),
    now = () => new Date().toISOString(),
    layoutLongSide = 1024,
    batchConcurrency = 3,
    cropReference: crop = cropReference,
  } = deps
  const generating = createStore<GeneratingState>()(() => ({
    panels: new Set(),
    batches: new Set(),
  }))
  const referenceOptOut = createStore<OptOutState>()(() => ({ panels: new Set() }))
  const hintOptOut = createStore<OptOutState>()(() => ({ panels: new Set() }))
  const setOptOut = (store: StoreApi<OptOutState>, projectId: ID, panelId: ID, use: boolean) =>
    store.setState((s) => {
      const panels = new Set(s.panels)
      if (use) panels.delete(generatingKey(projectId, panelId))
      else panels.add(generatingKey(projectId, panelId))
      return { panels }
    })
  const batchControllers = new Map<string, AbortController>()

  const toggle = (field: keyof GeneratingState, key: string | readonly string[], on: boolean) =>
    generating.setState((s) => {
      const keys = new Set(s[field])
      for (const k of typeof key === 'string' ? [key] : key) {
        if (on) keys.add(k)
        else keys.delete(k)
      }
      return field === 'panels' ? { panels: keys } : { batches: keys }
    })

  const loadCharacterRefs = async (cast: readonly Character[]) =>
    Promise.all(
      cast
        .filter((c): c is Character & { referenceRef: string } => c.referenceRef !== undefined)
        .map(async (c) => ({ characterId: c.id, image: await library.loadAsset(c.referenceRef) })),
    )

  const loadReference = async (
    reference: ReferenceImage | undefined,
    projectId: ID,
    panel: Panel,
    settings: ProjectSettings,
  ) => {
    if (!reference || !usesReference(referenceOptOut.getState(), projectId, panel.id))
      return undefined
    return crop(await library.loadAsset(reference.ref), settings.pageSize, panel.rect)
  }

  const loadPrevious = async (panel: Panel, instruction: string) => {
    const current = currentArt(panel)
    if (!current) throw new Error('修正指示つきの再生成には採用中の絵が要ります')
    return { parentId: current.id, art: await library.loadAsset(current.ref), instruction }
  }

  // 待つ間にプロジェクトが削除されると、書き込みが消したプロジェクトを復活させる
  const assertOpen = async (store: ProjectStore, projectId: ID) => {
    if (!(await library.isOpen(projectId, store)))
      throw new Error('生成中にプロジェクトが削除されました')
  }

  const run = async ({
    store,
    projectId,
    pageId,
    panelId,
    instruction,
    signal,
  }: GenerateRequest) => {
    signal?.throwIfAborted()
    const project = store.get()
    const page = findPage(project, pageId)?.page
    const panel = page && findPanel(page, panelId)?.panel
    if (!page || !panel) throw new Error(`panel ${panelId} is not in page ${pageId}`)
    const { settings, characters } = project

    const layoutPng = await renderLayoutPng(page, panelId, {
      width: layoutWidth(panel, settings, layoutLongSide),
      pageSize: settings.pageSize,
    })
    const referencePng = await loadReference(page.reference, projectId, panel, settings)
    const characterRefs = await loadCharacterRefs(panelCharacters(panel, characters))
    const previous = instruction === undefined ? undefined : await loadPrevious(panel, instruction)
    const hint = usesHint(hintOptOut.getState(), projectId, panelId)
      ? hintFor(page, panel, settings)
      : undefined
    const req: PanelArtRequest = {
      project: { settings, characters },
      page,
      panelId,
      layoutPng,
      ...(referencePng && { referencePng }),
      ...(characterRefs.length > 0 && { characterRefs }),
      ...(previous && { previous: { art: previous.art, instruction: previous.instruction } }),
      ...(hint && { hint }),
    }
    const res = await abortable(() => imageProvider.generatePanelArt(req), signal)
    signal?.throwIfAborted()
    await assertOpen(store, projectId)
    const ref = await library.putAsset(projectId, res.image, `art-${panelId}`)
    await assertOpen(store, projectId)
    // putAsset の間に中止されても、Patch を入れなければ利用者には見えない。アセットは残る
    signal?.throwIfAborted()
    const art: PanelArt = {
      id: newId(),
      ref,
      provider: res.provider,
      prompt: res.prompt,
      createdAt: now(),
      ...(previous && { instruction: previous.instruction, parentId: previous.parentId }),
    }
    // 待っている間にコマが動いていることがあるので、Patch はその時点の Project で組む
    store.applyPatch(addArtPatch(store.get(), pageId, panelId, art), {
      source: 'ai',
      label: previous ? `コマ ${panel.order} を修正して再生成` : `コマ ${panel.order} を生成`,
    })
  }

  /** 通知はせず、失敗なら理由を返す */
  const attempt = async (
    req: GenerateRequest,
  ): Promise<{ outcome: GenerateOutcome; error?: unknown }> => {
    const key = generatingKey(req.projectId, req.panelId)
    if (generating.getState().panels.has(key)) return { outcome: 'busy' }
    toggle('panels', key, true)
    try {
      await run(req)
      return { outcome: 'done' }
    } catch (error) {
      return req.signal?.aborted ? { outcome: 'canceled' } : { outcome: 'failed', error }
    } finally {
      toggle('panels', key, false)
    }
  }

  /** 診断のヒントを使うコマの panelHint。キーは Panel.id。空のヒントは入れない */
  const pageHints = (page: Page, settings: ProjectSettings, projectId: ID) => {
    const diagnosis = diagnosePage(page, settings)
    const hints: Record<ID, string> = {}
    for (const panel of page.panels) {
      if (!usesHint(hintOptOut.getState(), projectId, panel.id)) continue
      const d = diagnosis.panels.find((p) => p.panelId === panel.id)
      const hint = d ? panelHint(panel, d) : ''
      if (hint !== '') hints[panel.id] = hint
    }
    return hints
  }

  /**
   * ページ全体の配置図 → 参考画像（どれかのコマが使うときページ丸ごと）→ 登場キャラの参照画像 → コマごとのヒント →
   * generatePageArt → コマごとに切り抜き → putAsset → 1 回の applyPatch(ai)。
   * 絵を入れる間にコマが消えていれば、残りのコマにだけ入れてそのコマの id を返す。全部消えていれば throw
   */
  const runPage = async ({ store, projectId, pageId, panelIds, signal }: PageRunRequest) => {
    signal.throwIfAborted()
    const project = store.get()
    const found = findPage(project, pageId)
    if (!found) throw new Error(`page ${pageId} is not in project ${projectId}`)
    const { page } = found
    const { settings, characters } = project

    const layoutPng = await renderPageLayoutPng(page, {
      width: pageLayoutWidth(settings, layoutLongSide),
      pageSize: settings.pageSize,
    })
    const referencePng =
      page.reference &&
      panelIds.some((id) => usesReference(referenceOptOut.getState(), projectId, id))
        ? await library.loadAsset(page.reference.ref)
        : undefined
    const characterRefs = await loadCharacterRefs(pageCharacters(page, characters))
    const hints = pageHints(page, settings, projectId)
    const req: PageArtRequest = {
      project: { settings, characters },
      page,
      layoutPng,
      ...(referencePng && { referencePng }),
      ...(characterRefs.length > 0 && { characterRefs }),
      ...(Object.keys(hints).length > 0 && { hints }),
    }
    const res = await abortable(() => imageProvider.generatePageArt(req), signal)
    signal.throwIfAborted()
    // 待つ間にコマが動いていても、送った配置図と同じ位置で切る
    const crops = (await cropPanelArts(page, res.image)).filter((c) => panelIds.includes(c.panelId))
    await assertOpen(store, projectId)
    const arts = await Promise.all(
      crops.map(
        async (c): Promise<{ panelId: ID; art: PanelArt }> => ({
          panelId: c.panelId,
          art: {
            id: newId(),
            ref: await library.putAsset(projectId, c.image, `art-${c.panelId}`),
            provider: res.provider,
            prompt: res.prompt,
            createdAt: now(),
          },
        }),
      ),
    )
    await assertOpen(store, projectId)
    signal.throwIfAborted()

    const current = store.get()
    const missing: ID[] = []
    const patch = arts.flatMap(({ panelId, art }) => {
      try {
        return addArtPatch(current, pageId, panelId, art)
      } catch {
        missing.push(panelId)
        return []
      }
    })
    if (patch.length === 0) throw new Error('生成中にコマが消えました')
    store.applyPatch(patch, {
      source: 'ai',
      label: `ページ ${found.pageIndex + 1} のコマ ${arts.length - missing.length} 件を生成`,
    })
    return missing
  }

  /** 通知はせず、コマごとの結果の件数と、失敗なら理由を返す。ほかで生成中のコマは `busy` にして絵を入れない */
  const attemptPage = async (
    req: PageRunRequest,
  ): Promise<{ counts: Record<GenerateOutcome, number>; error?: unknown }> => {
    const counts: Record<GenerateOutcome, number> = { done: 0, busy: 0, failed: 0, canceled: 0 }
    const running = generating.getState().panels
    const panelIds = req.panelIds.filter((id) => !running.has(generatingKey(req.projectId, id)))
    counts.busy = req.panelIds.length - panelIds.length
    if (panelIds.length === 0) return { counts }
    const keys = panelIds.map((id) => generatingKey(req.projectId, id))
    toggle('panels', keys, true)
    try {
      const missing = await runPage({ ...req, panelIds })
      counts.done = panelIds.length - missing.length
      counts.failed = missing.length
      return missing.length > 0
        ? { counts, error: new Error('生成中にコマが消えました') }
        : { counts }
    } catch (error) {
      if (req.signal.aborted) {
        counts.canceled = panelIds.length
        return { counts }
      }
      counts.failed = panelIds.length
      return { counts, error }
    } finally {
      toggle('panels', keys, false)
    }
  }

  const batchTargets = (project: Project, pageIds: readonly ID[], includeGenerated: boolean) =>
    pageIds.flatMap((pageId) => {
      const panelIds = (findPage(project, pageId)?.page.panels ?? [])
        .filter((panel) => includeGenerated || panel.artId === undefined)
        .map((panel) => panel.id)
      return panelIds.length > 0 ? [{ pageId, panelIds }] : []
    })

  return {
    generating,
    referenceOptOut,
    setUseReference(projectId, panelId, use) {
      setOptOut(referenceOptOut, projectId, panelId, use)
    },
    hintOptOut,
    setUseHint(projectId, panelId, use) {
      setOptOut(hintOptOut, projectId, panelId, use)
    },
    async generate(req) {
      const { outcome, error } = await attempt(req)
      if (outcome === 'failed')
        notify(`コマの生成に失敗しました: ${errorMessage(error)}`, { signIn: needsSignIn(error) })
      return outcome
    },
    async generateAll({ store, projectId, scope, pageIds, includeGenerated }) {
      const key = generatingKey(projectId, scope)
      if (batchControllers.has(key)) return 'busy'
      const controller = new AbortController()
      batchControllers.set(key, controller)
      toggle('batches', key, true)
      const counts: Record<GenerateOutcome, number> = { done: 0, busy: 0, failed: 0, canceled: 0 }
      const errors: unknown[] = []
      try {
        const targets = batchTargets(store.get(), pageIds, includeGenerated)
        await runPool(targets, batchConcurrency, async ({ pageId, panelIds }) => {
          const { signal } = controller
          if (signal.aborted) {
            counts.canceled += panelIds.length
            return
          }
          if (!(await library.isOpen(projectId, store))) {
            controller.abort()
            counts.canceled += panelIds.length
            errors.push(new Error('生成中にプロジェクトが削除されました'))
            return
          }
          const page = await attemptPage({ store, projectId, pageId, panelIds, signal })
          for (const outcome of Object.keys(counts) as GenerateOutcome[]) {
            counts[outcome] += page.counts[outcome]
          }
          if (page.error !== undefined) errors.push(page.error)
        })
      } finally {
        batchControllers.delete(key)
        toggle('batches', key, false)
      }
      if (errors.length > 0) {
        const summary =
          counts.failed > 0
            ? `コマ ${counts.failed} 件の生成に失敗しました`
            : '一括生成を止めました'
        notify(`${summary}: ${errorMessage(errors[0])}`, { signIn: errors.some(needsSignIn) })
      }
      return counts
    },
    cancel(projectId, scope) {
      batchControllers.get(generatingKey(projectId, scope))?.abort()
    },
  }
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { createFakeImageProvider, SignInRequiredError } = await import('@manga/ai')
  const { fixtures } = await import('@manga/schema')
  const { createMemoryStorage } = await import('@manga/storage')
  const { createProjectLibrary } = await import('./project-library')
  const { createProjectStore } = await import('./store/project-store')

  const sample = fixtures.samplePage01
  const page = sample.episodes[0]?.pages[0]
  const panel = page?.panels[0]
  if (!page || !panel) throw new Error('fixture に panel がない')
  const pageId = page.id
  const panelId = panel.id
  const NOW = '2026-10-16T00:00:00.000Z'

  /** 渡さなかった生成は Fake のもの */
  const setup = (
    overrides: Partial<Pick<ImageProvider, 'generatePanelArt' | 'generatePageArt'>> = {},
  ) => {
    const imageProvider = { ...createFakeImageProvider(), ...overrides }
    const storage = createMemoryStorage()
    const library = createProjectLibrary(storage)
    const store = createProjectStore(sample, { saveProject: async () => {} })
    const notify = vi.fn<(message: string, opts: { signIn: boolean }) => void>()
    let open = true
    const generation = createPanelGeneration({
      // store は library.open を通さず作るので、開いている扱いにする
      library: { ...library, isOpen: async () => open },
      imageProvider,
      notify,
      now: () => NOW,
      layoutLongSide: 64,
    })
    const panelNow = () => {
      const found = findPanel(store.get().episodes[0]?.pages[0] ?? page, panelId)
      if (!found) throw new Error('panel が消えた')
      return found.panel
    }
    const generate = (instruction?: string) =>
      generation.generate({ store, projectId: sample.id, pageId, panelId, instruction })
    const close = () => {
      open = false
    }
    return { storage, library, store, notify, generation, generate, panelNow, close }
  }

  describe('generate', () => {
    test('adds one art, adopts it, and stores the image as an asset', async () => {
      const { generate, generation, panelNow, library, notify } = setup()
      const pending = generate()
      expect(generatingPanels(generation.generating.getState(), sample.id).has(panelId)).toBe(true)
      expect(await pending).toBe('done')
      expect(generatingPanels(generation.generating.getState(), sample.id).has(panelId)).toBe(false)
      const after = panelNow()
      expect(after.arts).toHaveLength(1)
      const art = after.arts[0]
      expect(after.artId).toBe(art?.id)
      expect(art).toMatchObject({ provider: 'fake', createdAt: NOW })
      expect(art?.instruction).toBeUndefined()
      expect(art?.parentId).toBeUndefined()
      expect((await library.loadAsset(art?.ref ?? '')).type).toBe('image/png')
      expect(notify).not.toHaveBeenCalled()
    })

    test('a regeneration with an instruction sends the previous art and links parentId', async () => {
      const seen: PanelArtRequest[] = []
      const fake = createFakeImageProvider()
      const { generate, panelNow } = setup({
        generatePanelArt(req) {
          seen.push(req)
          return fake.generatePanelArt(req)
        },
      })
      await generate()
      const first = panelNow().arts[0]
      expect(await generate('もっと明るく')).toBe('done')
      const after = panelNow()
      expect(after.arts).toHaveLength(2)
      expect(after.arts[1]).toMatchObject({ parentId: first?.id, instruction: 'もっと明るく' })
      expect(after.artId).toBe(after.arts[1]?.id)
      expect(seen[0]?.previous).toBeUndefined()
      expect(seen[1]?.previous?.instruction).toBe('もっと明るく')
      expect(seen[1]?.previous?.art).toBeInstanceOf(Blob)
    })

    test('an instruction without an adopted art fails without a patch', async () => {
      const { generate, panelNow, notify, store } = setup()
      expect(await generate('直して')).toBe('failed')
      expect(panelNow().arts).toHaveLength(0)
      expect(store.state.getState().canUndo).toBe(false)
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('採用中の絵'), { signIn: false })
    })

    test('undo returns artId to the previous art and redo moves forward', async () => {
      const { generate, panelNow, store } = setup()
      await generate()
      const first = panelNow().artId
      await generate('修正')
      const second = panelNow().artId
      expect(first).not.toBe(second)
      store.undo()
      expect(panelNow().artId).toBe(first)
      expect(panelNow().arts).toHaveLength(1)
      store.undo()
      expect(panelNow().artId).toBeUndefined()
      store.redo()
      store.redo()
      expect(panelNow().artId).toBe(second)
    })

    test('a provider failure notifies and leaves the project untouched', async () => {
      const { generate, notify, store } = setup({
        generatePanelArt: async () => {
          throw new Error('quota exceeded')
        },
      })
      const before = store.get()
      expect(await generate()).toBe('failed')
      expect(store.get()).toBe(before)
      expect(notify).toHaveBeenCalledWith('コマの生成に失敗しました: quota exceeded', {
        signIn: false,
      })
    })

    test('a failure for want of sign-in asks for sign-in', async () => {
      const { generate, notify } = setup({
        generatePanelArt: async () => {
          throw new SignInRequiredError()
        },
      })
      expect(await generate()).toBe('failed')
      expect(notify).toHaveBeenCalledWith('コマの生成に失敗しました: ログインが必要です', {
        signIn: true,
      })
    })

    test('the same panel is not generated twice at once', async () => {
      const { generate, panelNow } = setup()
      const [a, b] = await Promise.all([generate(), generate()])
      expect([a, b]).toEqual(['done', 'busy'])
      expect(panelNow().arts).toHaveLength(1)
    })

    test('sends the reference image of each character in the panel', async () => {
      const seen: PanelArtRequest[] = []
      const fake = createFakeImageProvider()
      const { generate, library, store } = setup({
        generatePanelArt(req) {
          seen.push(req)
          return fake.generatePanelArt(req)
        },
      })
      const characterId = panel.focusPoints.find((f) => f.characterId)?.characterId
      const index = sample.characters.findIndex((c) => c.id === characterId)
      if (index < 0) throw new Error('fixture の最初のコマにキャラの焦点がない')
      const ref = await library.putAsset(sample.id, new Blob(['ref'], { type: 'image/png' }))
      store.applyPatch([{ op: 'add', path: `/characters/${index}/referenceRef`, value: ref }])
      await generate()
      expect(seen[0]?.characterRefs?.map((r) => r.characterId)).toEqual([characterId])
    })

    test('sends the reference image of a character who is only in the cast', async () => {
      const seen: PanelArtRequest[] = []
      const fake = createFakeImageProvider()
      const { generate, library, store } = setup({
        generatePanelArt(req) {
          seen.push(req)
          return fake.generatePanelArt(req)
        },
      })
      const ref = await library.putAsset(sample.id, new Blob(['ref'], { type: 'image/png' }))
      const extra = { id: 'chr_extra', name: '通行人', shortName: '通', referenceRef: ref }
      store.applyPatch([
        { op: 'add', path: '/characters/-', value: extra },
        ...panelPatch(store.get(), pageId, panelId, [
          { op: 'add', path: '/cast', value: [extra.id] },
        ]),
      ])
      await generate()
      expect(seen[0]?.characterRefs?.map((r) => r.characterId)).toEqual([extra.id])
    })

    test('sends the panel hint unless the panel opts out of it', async () => {
      const seen: PanelArtRequest[] = []
      const fake = createFakeImageProvider()
      const { generate, generation } = setup({
        generatePanelArt(req) {
          seen.push(req)
          return fake.generatePanelArt(req)
        },
      })
      // docs/fixtures/sample-page-01.diagnosis.json の pn_1 の hint
      const expected =
        '視線は中央の glass-crystal forest を大きく捉え、右上の フキダシ から中央下の E tiny, walking へ流れる'

      await generate()
      expect(seen[0]?.hint).toBe(expected)

      generation.setUseHint(sample.id, panelId, false)
      expect(usesHint(generation.hintOptOut.getState(), sample.id, panelId)).toBe(false)
      await generate()
      expect(seen[1]).not.toHaveProperty('hint')

      generation.setUseHint(sample.id, panelId, true)
      await generate()
      expect(seen[2]?.hint).toBe(expected)
    })

    test('a panel with an empty hint sends no hint', async () => {
      const seen: PanelArtRequest[] = []
      const fake = createFakeImageProvider()
      const { generate, store } = setup({
        generatePanelArt(req) {
          seen.push(req)
          return fake.generatePanelArt(req)
        },
      })
      store.applyPatch([
        { op: 'replace', path: '/episodes/0/pages/0/panels/0/vectors', value: [] },
        { op: 'replace', path: '/episodes/0/pages/0/panels/0/focusPoints', value: [] },
        { op: 'replace', path: '/episodes/0/pages/0/panels/0/bubbles', value: [] },
      ])
      await generate()
      expect(seen[0]).not.toHaveProperty('hint')
    })

    test('a project removed while generating fails without a patch or an asset', async () => {
      const fake = createFakeImageProvider()
      let close = () => {}
      const { generate, notify, store, ...rest } = setup({
        async generatePanelArt(req) {
          close()
          return fake.generatePanelArt(req)
        },
      })
      close = rest.close
      const before = store.get()
      expect(await generate()).toBe('failed')
      expect(store.get()).toBe(before)
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('削除されました'), {
        signIn: false,
      })
    })

    test('a panel removed while generating fails without a patch', async () => {
      let release = () => {}
      let started = () => {}
      const providerCalled = new Promise<void>((resolve) => {
        started = resolve
      })
      const fake = createFakeImageProvider()
      const { generate, notify, store } = setup({
        async generatePanelArt(req) {
          started()
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return fake.generatePanelArt(req)
        },
      })
      const pending = generate()
      await providerCalled
      store.applyPatch([{ op: 'remove', path: '/episodes/0/pages/0/panels/0' }])
      const before = store.get()
      release()
      expect(await pending).toBe('failed')
      expect(store.get()).toBe(before)
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('コマが消えました'), {
        signIn: false,
      })
    })
  })

  describe('generateAll', () => {
    const pagePanels = (store: ProjectStore) => store.get().episodes[0]?.pages[0]?.panels ?? []

    /** generatePageArt と generatePanelArt の呼び出しを数え、受けた要求を残す */
    const counting = () => {
      const fake = createFakeImageProvider()
      const seen: PageArtRequest[] = []
      const calls = { page: 0, panel: 0 }
      const provider = {
        async generatePageArt(req: PageArtRequest) {
          calls.page++
          seen.push(req)
          return fake.generatePageArt(req)
        },
        async generatePanelArt(req: PanelArtRequest) {
          calls.panel++
          return fake.generatePanelArt(req)
        },
      }
      return { provider, seen, calls }
    }

    const all = (store: ProjectStore, includeGenerated = false) => ({
      store,
      projectId: sample.id,
      scope: `page/${pageId}`,
      pageIds: [pageId],
      includeGenerated,
    })

    test('generates the page in one call and puts a crop of it in every panel in one undo step', async () => {
      const { provider, calls } = counting()
      const { generation, store, library, notify } = setup(provider)
      expect(await generation.generateAll(all(store))).toEqual({
        done: 6,
        busy: 0,
        failed: 0,
        canceled: 0,
      })
      expect(calls).toEqual({ page: 1, panel: 0 })
      const panels = pagePanels(store)
      expect(panels.map((p) => p.arts.length)).toEqual([1, 1, 1, 1, 1, 1])
      expect(new Set(panels.map((p) => p.arts[0]?.prompt)).size).toBe(1)
      for (const p of panels) {
        expect(p.artId).toBe(p.arts[0]?.id)
        expect((await library.loadAsset(p.arts[0]?.ref ?? '')).type).toBe('image/png')
      }
      expect(notify).not.toHaveBeenCalled()

      store.undo()
      expect(pagePanels(store).every((p) => p.artId === undefined)).toBe(true)
    })

    test('without includeGenerated it fills only the panels without art, and skips a full page', async () => {
      const { provider, calls } = counting()
      const { generation, store, generate } = setup(provider)
      await generate()
      expect(await generation.generateAll(all(store))).toMatchObject({ done: 5 })
      expect(pagePanels(store).map((p) => p.arts.length)).toEqual([1, 1, 1, 1, 1, 1])
      expect(calls).toEqual({ page: 1, panel: 1 })

      expect(await generation.generateAll(all(store))).toMatchObject({ done: 0 })
      expect(calls.page).toBe(1)

      expect(await generation.generateAll(all(store, true))).toMatchObject({ done: 6 })
      expect(pagePanels(store).map((p) => p.arts.length)).toEqual([2, 2, 2, 2, 2, 2])
    })

    test('a panel being generated on its own is busy and gets no crop', async () => {
      let release = () => {}
      const fake = createFakeImageProvider()
      const { generation, store, generate } = setup({
        async generatePanelArt(req) {
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return fake.generatePanelArt(req)
        },
      })
      const single = generate()
      expect(await generation.generateAll(all(store))).toMatchObject({ done: 5, busy: 1 })
      expect(pagePanels(store).find((p) => p.id === panelId)?.arts).toHaveLength(0)
      release()
      expect(await single).toBe('done')
      expect(pagePanels(store).find((p) => p.id === panelId)?.arts).toHaveLength(1)
    })

    test('sends the reference images of the page cast, most frequent first, and hints per panel', async () => {
      const { provider, seen } = counting()
      const { generation, store, library } = setup(provider)
      const ref = await library.putAsset(sample.id, new Blob(['ref'], { type: 'image/png' }))
      const once = { id: 'chr_once', name: '一度', shortName: '一', referenceRef: ref }
      const often = { id: 'chr_often', name: '何度も', shortName: '何', referenceRef: ref }
      const castOf = (i: number) => (i === 0 ? [once.id] : i < 4 ? [often.id] : [])
      store.applyPatch([
        { op: 'add', path: '/characters/-', value: once },
        { op: 'add', path: '/characters/-', value: often },
        { op: 'add', path: '/episodes/0/pages/0/cast', value: [once.id] },
        ...pagePanels(store).flatMap((_, i) =>
          castOf(i).length > 0
            ? [
                {
                  op: 'add' as const,
                  path: `/episodes/0/pages/0/panels/${i}/cast`,
                  value: castOf(i),
                },
              ]
            : [],
        ),
      ])
      generation.setUseHint(sample.id, panelId, false)
      await generation.generateAll(all(store))
      expect(seen[0]?.characterRefs?.map((r) => r.characterId)).toEqual([often.id, once.id])
      expect(seen[0]?.hints).toBeDefined()
      expect(seen[0]?.hints).not.toHaveProperty(panelId)
      expect(Object.keys(seen[0]?.hints ?? {}).length).toBeGreaterThan(0)
    })

    test('a page failure notifies once with the number of panels and leaves the project untouched', async () => {
      const { generation, store, notify } = setup({
        generatePageArt: async () => {
          throw new Error('quota exceeded')
        },
      })
      const before = store.get()
      expect(await generation.generateAll(all(store))).toMatchObject({ failed: 6, done: 0 })
      expect(store.get()).toBe(before)
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify).toHaveBeenCalledWith('コマ 6 件の生成に失敗しました: quota exceeded', {
        signIn: false,
      })
    })

    test('a panel removed while the page is generated is counted as failed, the rest get art', async () => {
      let release = () => {}
      let started = () => {}
      const called = new Promise<void>((resolve) => {
        started = resolve
      })
      const fake = createFakeImageProvider()
      const { generation, store, notify } = setup({
        async generatePageArt(req) {
          started()
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return fake.generatePageArt(req)
        },
      })
      const pending = generation.generateAll(all(store))
      await called
      store.applyPatch([{ op: 'remove', path: '/episodes/0/pages/0/panels/0' }])
      release()
      expect(await pending).toMatchObject({ done: 5, failed: 1 })
      expect(pagePanels(store).map((p) => p.arts.length)).toEqual([1, 1, 1, 1, 1])
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('コマが消えました'), {
        signIn: false,
      })
    })

    test('cancel drops the page reply without a patch', async () => {
      let started = () => {}
      const called = new Promise<void>((resolve) => {
        started = resolve
      })
      const { generation, store, notify } = setup({
        generatePageArt: () => {
          started()
          return new Promise(() => {})
        },
      })
      const pending = generation.generateAll(all(store))
      await called
      generation.cancel(sample.id, `page/${pageId}`)
      expect(await pending).toMatchObject({ canceled: 6, done: 0 })
      expect(pagePanels(store).every((p) => p.arts.length === 0)).toBe(true)
      expect(notify).not.toHaveBeenCalled()
      expect(batchRunning(generation.generating.getState(), sample.id, `page/${pageId}`)).toBe(
        false,
      )
    })
  })

  test('addArtPatch drops a parentId that is no longer in arts', () => {
    const art: PanelArt = {
      id: 'art_new',
      ref: 'blob:x',
      provider: 'fake',
      prompt: 'p',
      createdAt: NOW,
      parentId: 'art_gone',
      instruction: 'i',
    }
    const patch = addArtPatch(sample, pageId, panelId, art)
    expect(patch).toEqual([
      {
        op: 'add',
        path: '/episodes/0/pages/0/panels/0/arts/-',
        value: { ...art, parentId: undefined },
      },
      { op: 'add', path: '/episodes/0/pages/0/panels/0/artId', value: 'art_new' },
    ])
    expect(patch[0]?.value).not.toHaveProperty('parentId')
  })
}
