import {
  type CritiquePatchCheck,
  type CritiqueRequest,
  type CritiqueResponse,
  checkCritiquePatch,
  pageRootedPatch,
} from '@manga/ai'
import type { ID, Page, PageDiagnosis, Patch } from '@manga/schema'
import { applyPatches, produce } from 'immer'
import { findPage, pagePatch } from './project-ops'
import { toImmerPatch } from './store/json-patch'
import type { ProjectStore } from './store/project-store'

export type Suggestion = CritiqueResponse['suggestions'][number]

/**
 * - `applied`: 今のページにもう入っている。Undo で外れると `ready` に戻る
 * - `ready`: 適用できる。`patch` はページを根にしたもの
 * - `rejected`: 許されない操作か、今のページに当てられない。`reason` を警告として出す
 */
export type SuggestionState =
  | { kind: 'applied'; patch: Patch }
  | { kind: 'ready'; patch: Patch }
  | { kind: 'rejected'; reason: string }

/**
 * critique に送るページ。手描きの線、絵の履歴、参考画像は提案に使わないうえ本文を膨らませるので外す。
 * 送る diagnosis は画面に出しているものと同じ
 */
export function critiqueRequest(page: Page, diagnosis: PageDiagnosis): CritiqueRequest {
  const { reference: _reference, ...rest } = page
  return {
    page: {
      ...rest,
      scribbles: [],
      panels: page.panels.map(({ artId: _artId, ...panel }) => ({ ...panel, arts: [] })),
    },
    diagnosis,
  }
}

/** ページを根にした patch を page に当てた結果。当てられなければ undefined */
export function previewPage(page: Page, patch: Patch): Page | undefined {
  try {
    return produce(page, (draft) => {
      // 1 操作ずつ変換するのは store と同じく、後ろの操作のパスが前の操作の結果で解決されるため
      for (const op of patch) applyPatches(draft, [toImmerPatch(draft, op)])
    })
  } catch {
    return undefined
  }
}

const POS_PATH = /^\/panels\/(\d+)\/(focusPoints|bubbles)\/(\d+)\/pos$/
const VECTOR_PATH = /^\/panels\/(\d+)\/vectors\/(-|\d+)$/

/** ページを根にした patch の操作が、どれも今の page にすでに入っているか */
function isApplied(page: Page, patch: Patch): boolean {
  return patch.every((op) => {
    const vector = VECTOR_PATH.exec(op.path)
    if (vector && op.op === 'add') {
      const id = (op.value as { id?: unknown } | undefined)?.id
      return page.panels[Number(vector[1])]?.vectors.some((v) => v.id === id) ?? false
    }
    const pos = POS_PATH.exec(op.path)
    if (!pos || op.op !== 'replace') return false
    const panel = page.panels[Number(pos[1])]
    const item = (pos[2] === 'focusPoints' ? panel?.focusPoints : panel?.bubbles)?.[Number(pos[3])]
    const value = op.value as { x?: unknown; y?: unknown } | undefined
    return item !== undefined && item.pos.x === value?.x && item.pos.y === value?.y
  })
}

/**
 * 提案が今の page に対してどの状態か。すでに入っているかを先に見るのは、
 * 適用済みのベクトルの追加は id の重なりとして checkCritiquePatch に拒否されるため
 */
export function suggestionState(page: Page, suggestion: Suggestion): SuggestionState {
  const rooted = pageRootedPatch(suggestion.patch)
  if (rooted.length > 0 && isApplied(page, rooted)) return { kind: 'applied', patch: rooted }
  const checked: CritiquePatchCheck = checkCritiquePatch(page, suggestion.patch)
  if (!checked.ok) return { kind: 'rejected', reason: checked.reason }
  if (!previewPage(page, checked.patch)) {
    return { kind: 'rejected', reason: '今のページに当てられない提案です' }
  }
  return { kind: 'ready', patch: checked.patch }
}

/** ページを根にした patch が触るコマの id。重なりなく、出てきた順 */
export function touchedPanelIds(page: Page, patch: Patch): ID[] {
  const ids = patch.flatMap((op) => {
    const index = /^\/panels\/(\d+)\//.exec(op.path)?.[1]
    const panel = index === undefined ? undefined : page.panels[Number(index)]
    return panel ? [panel.id] : []
  })
  return [...new Set(ids)]
}

/**
 * 提案を store の今のページに照らして検査し、`source: 'ai'`、`label: message` の 1 手として入れる。
 * Undo 1 回で戻る。適用できなければ理由を throw し、store は変えない。入れた Patch（ページ根）を返す
 */
export function applySuggestion(store: ProjectStore, pageId: ID, suggestion: Suggestion): Patch {
  const project = store.get()
  const page = findPage(project, pageId)?.page
  if (!page) throw new Error('ページがもうありません')
  const state = suggestionState(page, suggestion)
  if (state.kind === 'rejected') throw new Error(state.reason)
  if (state.kind === 'applied') throw new Error('この提案はもう適用されています')
  store.applyPatch(pagePatch(project, pageId, state.patch), {
    source: 'ai',
    label: suggestion.message,
  })
  return state.patch
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { aiFixtures, createFakeLlmProvider } = await import('@manga/ai')
  const { diagnosePage } = await import('@manga/diagnosis')
  const { fixtures } = await import('@manga/schema')
  const { createProjectStore } = await import('./store/project-store')

  const project = fixtures.samplePage01
  const page = project.episodes[0]?.pages[0] as Page
  const pageId = page.id
  const setup = () => createProjectStore(project, { saveProject: async () => {} })
  const currentPage = (store: ProjectStore) => findPage(store.get(), pageId)?.page as Page
  const rectSuggestion: Suggestion = {
    message: 'コマ 1 を広げる',
    patch: [{ op: 'replace', path: '/episodes/0/pages/0/panels/0/rect/w', value: 0.9 }],
  }

  test('critiqueRequest drops scribbles, arts and the reference image', () => {
    const withExtras: Page = {
      ...page,
      reference: { ref: 'r', opacity: 0.5, visible: true },
      scribbles: [{ id: 's', points: [{ x: 0, y: 0 }], width: 0.01, color: 'ink' }],
      panels: page.panels.map((p) => ({
        ...p,
        arts: [{ id: 'a', ref: 'x', provider: 'f', prompt: 'p', createdAt: project.createdAt }],
        artId: 'a',
      })),
    }
    const diagnosis = diagnosePage(page, project.settings)
    const req = critiqueRequest(withExtras, diagnosis)
    expect(req.diagnosis).toBe(diagnosis)
    expect(req.page.reference).toBeUndefined()
    expect(req.page.scribbles).toEqual([])
    for (const panel of req.page.panels) {
      expect(panel.arts).toEqual([])
      expect(panel.artId).toBeUndefined()
    }
  })

  describe('Fake で end-to-end', () => {
    test('相談の提案を仮適用、適用、Undo できる', async () => {
      const store = setup()
      const diagnosis = diagnosePage(page, project.settings)
      const res = await createFakeLlmProvider().critique(critiqueRequest(page, diagnosis))
      expect(res.summary).not.toBe('')
      expect(res.suggestions.length).toBeGreaterThan(0)

      for (const suggestion of res.suggestions) {
        const before = currentPage(store)
        const state = suggestionState(before, suggestion)
        expect(state.kind).toBe('ready')
        if (state.kind !== 'ready') continue
        const ghost = previewPage(before, state.patch)

        applySuggestion(store, pageId, suggestion)
        const after = currentPage(store)
        expect(after).toEqual(ghost)
        expect(after).not.toEqual(before)
        expect(suggestionState(after, suggestion).kind).toBe('applied')
        // 診断は適用後のページで計算し直せる
        expect(diagnosePage(after, project.settings).pageId).toBe(pageId)
      }

      for (let i = 0; i < res.suggestions.length; i++) store.undo()
      expect(currentPage(store)).toEqual(page)
      for (const suggestion of res.suggestions) {
        expect(suggestionState(currentPage(store), suggestion).kind).toBe('ready')
      }
    })

    test('適用は 1 回の Undo で戻り、Redo でまた入る', () => {
      const store = setup()
      const suggestion = aiFixtures.critique.suggestions[0] as Suggestion
      applySuggestion(store, pageId, suggestion)
      const applied = currentPage(store)
      store.undo()
      expect(currentPage(store)).toEqual(page)
      store.redo()
      expect(currentPage(store)).toEqual(applied)
    })
  })

  describe('rect を触る Patch を拒否する', () => {
    test('状態は rejected で、理由に rect を含む', () => {
      const state = suggestionState(page, rectSuggestion)
      expect(state.kind).toBe('rejected')
      if (state.kind === 'rejected') expect(state.reason).toContain('rect')
    })

    test('applySuggestion は throw し、store も履歴も変えない', () => {
      const store = setup()
      expect(() => applySuggestion(store, pageId, rectSuggestion)).toThrow('rect')
      expect(store.get()).toBe(project)
      expect(store.state.getState().canUndo).toBe(false)
    })
  })

  test('適用済みの提案は二度入れない', () => {
    const store = setup()
    const suggestion = aiFixtures.critique.suggestions[1] as Suggestion
    applySuggestion(store, pageId, suggestion)
    expect(() => applySuggestion(store, pageId, suggestion)).toThrow('もう適用')
  })

  test('touchedPanelIds lists the panels a patch touches', () => {
    const patch = aiFixtures.critique.suggestions.flatMap((s) => pageRootedPatch(s.patch))
    expect(touchedPanelIds(page, patch)).toEqual(['pn_4', 'pn_5', 'pn_6'])
  })

  test('previewPage returns undefined for a patch that does not fit the page', () => {
    const patch: Patch = [{ op: 'replace', path: '/panels/9/bubbles/0/pos', value: { x: 0, y: 0 } }]
    expect(previewPage(page, patch)).toBeUndefined()
  })
}
