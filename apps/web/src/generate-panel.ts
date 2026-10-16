import type { ImageProvider, PanelArtRequest } from '@manga/ai'
import { renderLayoutPng } from '@manga/render'
import {
  type Character,
  currentArt,
  type ID,
  newId,
  type Panel,
  type PanelArt,
  type Patch,
  type Project,
  type ProjectSettings,
  type ReferenceImage,
} from '@manga/schema'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { findPanel, panelPatch } from './inspector-ops'
import type { ProjectLibrary } from './project-library'
import { findPage } from './project-ops'
import { cropReference } from './reference-image'
import { errorMessage } from './route-error'
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

/** 参考画像を使わないコマ。キーは generatingKey と同じ形 */
interface ReferenceOptOutState {
  panels: Set<string>
}

/** コマの生成に参考画像を渡すか。既定は渡す */
export function usesReference(state: ReferenceOptOutState, projectId: ID, panelId: ID): boolean {
  return !state.panels.has(generatingKey(projectId, panelId))
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
  /** 対象のページ。並びの順にコマへ分解する */
  pageIds: readonly ID[]
  /** false なら絵の無いコマだけを生成する */
  includeGenerated: boolean
}

/** 範囲がすでに走っていれば `busy`。それ以外はコマごとの結果の件数 */
type BatchOutcome = 'busy' | Record<GenerateOutcome, number>

export interface PanelGeneration {
  readonly generating: StoreApi<GeneratingState>
  /** コマごとの「参考画像を使う」のオフ。データモデルに項目が無いので、開いている間だけ持つ */
  readonly referenceOptOut: StoreApi<ReferenceOptOutState>
  setUseReference(projectId: ID, panelId: ID, use: boolean): void
  generate(req: GenerateRequest): Promise<GenerateOutcome>
  /** 範囲のコマを同時 `batchConcurrency` 本で生成する。失敗はまとめて 1 回通知する */
  generateAll(req: BatchRequest): Promise<BatchOutcome>
  /** 走っている一括生成を止める。生成中のコマの応答は捨て、まだのコマは始めない */
  cancel(projectId: ID, scope: string): void
}

export interface PanelGenerationDeps {
  library: Pick<ProjectLibrary, 'isOpen' | 'loadAsset' | 'putAsset'>
  imageProvider: ImageProvider
  /** 失敗の文言の出し先。既定はトースト */
  notify?(message: string): void
  now?(): string
  /** ImageProvider に渡す配置図の長辺 px。既定 1024 */
  layoutLongSide?: number
  /** 一括生成の同時実行数。既定 3 */
  batchConcurrency?: number
  /** 参考画像からコマの範囲を切り抜く。既定は canvas で描く `cropReference` */
  cropReference?: typeof cropReference
}

/** コマに登場するキャラ。フキダシの speakerId と焦点の characterId を登場順に、重複なく集める */
function panelCharacters(panel: Panel, characters: readonly Character[]): Character[] {
  const ids = [
    ...panel.bubbles.map((b) => b.speakerId),
    ...panel.focusPoints.map((f) => f.characterId),
  ].filter((id): id is ID => id !== undefined)
  return [...new Set(ids)].flatMap((id) => characters.filter((c) => c.id === id))
}

/** コマの実寸の縦横比で、長辺を `longSide` にしたときの幅 */
function layoutWidth(panel: Panel, settings: ProjectSettings, longSide: number): number {
  const { pageSize } = settings
  const aspect = (panel.rect.h * pageSize.h) / (panel.rect.w * pageSize.w)
  return Math.round(aspect > 1 ? longSide / aspect : longSide)
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
 * 02-architecture.md のデータフロー「生成」を 1 コマ分まとめる。
 * 配置図 → 参考画像の切り抜き → 登場キャラの参照画像 → 前回の絵（修正指示つきのとき）→ ImageProvider → putAsset → applyPatch(ai)。
 * 生成は store の外で進め、結果だけを Patch で入れるので Undo で生成前に戻せる。アセットは残る。
 * 進行中のコマは `generating` に持ち、画面を離れても生き続ける。同じコマの二重起動は `busy` で断る
 */
export function createPanelGeneration(deps: PanelGenerationDeps): PanelGeneration {
  const {
    library,
    imageProvider,
    notify = (message) => toasts.push(message),
    now = () => new Date().toISOString(),
    layoutLongSide = 1024,
    batchConcurrency = 3,
    cropReference: crop = cropReference,
  } = deps
  const generating = createStore<GeneratingState>()(() => ({
    panels: new Set(),
    batches: new Set(),
  }))
  const referenceOptOut = createStore<ReferenceOptOutState>()(() => ({ panels: new Set() }))
  const batchControllers = new Map<string, AbortController>()

  const toggle = (field: keyof GeneratingState, key: string, on: boolean) =>
    generating.setState((s) => {
      const keys = new Set(s[field])
      if (on) keys.add(key)
      else keys.delete(key)
      return field === 'panels' ? { panels: keys } : { batches: keys }
    })

  const loadCharacterRefs = async (panel: Panel, characters: readonly Character[]) =>
    Promise.all(
      panelCharacters(panel, characters)
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
    const characterRefs = await loadCharacterRefs(panel, characters)
    const previous = instruction === undefined ? undefined : await loadPrevious(panel, instruction)
    const req: PanelArtRequest = {
      project: { settings, characters },
      page,
      panelId,
      layoutPng,
      ...(referencePng && { referencePng }),
      ...(characterRefs.length > 0 && { characterRefs }),
      ...(previous && { previous: { art: previous.art, instruction: previous.instruction } }),
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

  const batchTargets = (project: Project, pageIds: readonly ID[], includeGenerated: boolean) =>
    pageIds.flatMap((pageId) =>
      (findPage(project, pageId)?.page.panels ?? [])
        .filter((panel) => includeGenerated || panel.artId === undefined)
        .toSorted((a, b) => a.order - b.order)
        .map((panel) => ({ pageId, panelId: panel.id })),
    )

  return {
    generating,
    referenceOptOut,
    setUseReference(projectId, panelId, use) {
      referenceOptOut.setState((s) => {
        const panels = new Set(s.panels)
        if (use) panels.delete(generatingKey(projectId, panelId))
        else panels.add(generatingKey(projectId, panelId))
        return { panels }
      })
    },
    async generate(req) {
      const { outcome, error } = await attempt(req)
      if (outcome === 'failed') notify(`コマの生成に失敗しました: ${errorMessage(error)}`)
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
        await runPool(targets, batchConcurrency, async ({ pageId, panelId }) => {
          const { signal } = controller
          if (signal.aborted) {
            counts.canceled++
            return
          }
          if (!(await library.isOpen(projectId, store))) {
            controller.abort()
            counts.canceled++
            errors.push(new Error('生成中にプロジェクトが削除されました'))
            return
          }
          const { outcome, error } = await attempt({ store, projectId, pageId, panelId, signal })
          counts[outcome]++
          if (outcome === 'failed') errors.push(error)
        })
      } finally {
        batchControllers.delete(key)
        toggle('batches', key, false)
      }
      if (errors.length > 0)
        notify(`コマ ${errors.length} 件の生成に失敗しました: ${errorMessage(errors[0])}`)
      return counts
    },
    cancel(projectId, scope) {
      batchControllers.get(generatingKey(projectId, scope))?.abort()
    },
  }
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { createFakeImageProvider } = await import('@manga/ai')
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

  const setup = (imageProvider: ImageProvider = createFakeImageProvider()) => {
    const storage = createMemoryStorage()
    const library = createProjectLibrary(storage)
    const store = createProjectStore(sample, { saveProject: async () => {} })
    const notify = vi.fn<(message: string) => void>()
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
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('採用中の絵'))
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
      expect(notify).toHaveBeenCalledWith('コマの生成に失敗しました: quota exceeded')
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
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('削除されました'))
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
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('コマが消えました'))
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
