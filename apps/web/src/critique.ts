import {
  type CritiquePatchCheck,
  type CritiqueRequest,
  type CritiqueResponse,
  checkCritiquePatch,
  pageRootedPatch,
} from '@manga/ai'
import { m } from '@manga/i18n'
import {
  type Bubble,
  fitBubble,
  type ID,
  type Page,
  type PageDiagnosis,
  type Patch,
  type Point,
  type Size,
} from '@manga/schema'
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
 * critique に送るページ。手描きの線、下描き、絵の履歴、参考画像は提案に使わないうえ本文を膨らませるので外す。
 * 送る diagnosis は画面に出しているものと同じ
 */
export function critiqueRequest(page: Page, diagnosis: PageDiagnosis): CritiqueRequest {
  const { reference: _reference, sketch: _sketch, ...rest } = page
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

type PageSize = Pick<Size, 'w' | 'h'>

/**
 * フキダシの pos を置き換える操作の値を、overflow でない限り本体が枠に収まる中心にした patch。
 * 提案は pos しか触れないので、大きさは変えない。pageSize はページの大きさ（mm）
 */
function fitBubbleMoves(page: Page, patch: Patch, pageSize: PageSize): Patch {
  return patch.map((op) => {
    const pos = POS_PATH.exec(op.path)
    if (pos?.[2] !== 'bubbles' || op.op !== 'replace') return op
    const panel = page.panels[Number(pos[1])]
    const bubble = panel?.bubbles[Number(pos[3])]
    const value = op.value as Partial<Point> | undefined
    if (!panel || !bubble || bubble.overflow || typeof value?.x !== 'number') return op
    if (typeof value.y !== 'number') return op
    const fitted = fitBubble({ ...bubble, pos: { x: value.x, y: value.y } }, { panel, pageSize })
    return { ...op, value: fitted.pos }
  })
}

/** ページを根にした patch の操作が、どれも今の page にすでに入っているか */
function isApplied(page: Page, patch: Patch): boolean {
  return patch.every((op) => {
    const vector = VECTOR_PATH.exec(op.path)
    if (vector && op.op === 'add') {
      const value = JSON.stringify(op.value)
      return (
        page.panels[Number(vector[1])]?.vectors.some((v) => JSON.stringify(v) === value) ?? false
      )
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
 * 提案が今の page に対してどの状態か。フキダシの移動は枠に収まる位置へ直した patch にする。
 * pageSize はページの大きさ（mm）。すでに入っているかを先に見るのは、
 * 適用済みのベクトルの追加は id の重なりとして checkCritiquePatch に拒否されるため
 */
export function suggestionState(
  page: Page,
  suggestion: Suggestion,
  pageSize: PageSize,
): SuggestionState {
  const rooted = fitBubbleMoves(page, pageRootedPatch(suggestion.patch), pageSize)
  if (rooted.length > 0 && isApplied(page, rooted)) return { kind: 'applied', patch: rooted }
  const checked: CritiquePatchCheck = checkCritiquePatch(page, suggestion.patch)
  if (!checked.ok) return { kind: 'rejected', reason: checked.reason }
  const patch = fitBubbleMoves(page, checked.patch, pageSize)
  if (!previewPage(page, patch)) {
    return { kind: 'rejected', reason: m.web_critique_inapplicable() }
  }
  return { kind: 'ready', patch }
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
  if (!page) throw new Error(m.web_common_page_gone())
  const state = suggestionState(page, suggestion, project.settings.pageSize)
  if (state.kind === 'rejected') throw new Error(state.reason)
  if (state.kind === 'applied') throw new Error(m.web_critique_already_applied())
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
  const { bubbleFits, fixtures } = await import('@manga/schema')
  const { createProjectStore } = await import('./store/project-store')

  const project = fixtures.samplePage01
  const pageSize = project.settings.pageSize
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
        const state = suggestionState(before, suggestion, pageSize)
        expect(state.kind).toBe('ready')
        if (state.kind !== 'ready') continue
        const ghost = previewPage(before, state.patch)

        applySuggestion(store, pageId, suggestion)
        const after = currentPage(store)
        expect(after).toEqual(ghost)
        expect(after).not.toEqual(before)
        expect(suggestionState(after, suggestion, pageSize).kind).toBe('applied')
        // 診断は適用後のページで計算し直せる
        expect(diagnosePage(after, project.settings).pageId).toBe(pageId)
      }

      for (let i = 0; i < res.suggestions.length; i++) store.undo()
      expect(currentPage(store)).toEqual(page)
      for (const suggestion of res.suggestions) {
        expect(suggestionState(currentPage(store), suggestion, pageSize).kind).toBe('ready')
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
      const state = suggestionState(page, rectSuggestion, pageSize)
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

  test('既存の id で中身の違うベクトルの追加は適用済みにせず、拒否する', () => {
    const index = page.panels.findIndex((p) => p.vectors.length > 0)
    const existing = page.panels[index]?.vectors[0]
    expect(existing).toBeDefined()
    if (!existing) return
    const suggestion: Suggestion = {
      message: '既存の id でベクトルを足す',
      patch: [
        {
          op: 'add',
          path: `/panels/${index}/vectors/-`,
          value: { ...existing, to: { x: existing.from.x, y: existing.from.y } },
        },
      ],
    }
    expect(suggestionState(page, suggestion, pageSize).kind).toBe('rejected')
  })

  test('a bubble move toward the frame stops inside it, and an overflow bubble goes past it', () => {
    const index = page.panels.findIndex((p) => p.bubbles.length > 0)
    const outside: Suggestion = {
      message: 'フキダシを端へ',
      patch: [{ op: 'replace', path: `/panels/${index}/bubbles/0/pos`, value: { x: 1, y: 0 } }],
    }
    const state = suggestionState(page, outside, pageSize)
    expect(state.kind).toBe('ready')
    const ghost = state.kind === 'ready' ? previewPage(page, state.patch) : undefined
    const panel = ghost?.panels[index]
    expect(panel && bubbleFits(panel.bubbles[0] as Bubble, { panel, pageSize })).toBe(true)

    const store = setup()
    applySuggestion(store, pageId, outside)
    expect(suggestionState(currentPage(store), outside, pageSize).kind).toBe('applied')

    const overflowing: Page = {
      ...page,
      panels: page.panels.map((p, i) =>
        i === index ? { ...p, bubbles: p.bubbles.map((b) => ({ ...b, overflow: true })) } : p,
      ),
    }
    const free = suggestionState(overflowing, outside, pageSize)
    expect(free.kind === 'ready' && free.patch[0]).toMatchObject({ value: { x: 1, y: 0 } })
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
