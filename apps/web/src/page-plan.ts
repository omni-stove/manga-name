import type { PagePlanRequest } from '@manga/ai'
import {
  type Character,
  createPage,
  type Page,
  type PagePlan,
  type PageTemplate,
  type Project,
} from '@manga/schema'

/** 「脚本から下書き」のモーダルで入れるもの */
interface ScriptDraftInput {
  script: string
  /** 脚本を割り振るページ数。省くと LLM に任せる */
  pageCount?: number
  /** トーンのヒント。空なら送らない */
  tone: string
}

/** ページ数に入れられる上限。Workers が受け付けるページ数の上限と揃える */
export const MAX_PAGE_COUNT = 64

/** ページ数の欄を読む。空は undefined、1〜MAX_PAGE_COUNT の整数でなければ null */
export function parsePageCount(text: string): number | undefined | null {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  return Number.isInteger(n) && n >= 1 && n <= MAX_PAGE_COUNT ? n : null
}

/** ページ数の欄に一押しで入れる、商業誌の 1 回分の目安。`pages` は MAX_PAGE_COUNT 以下 */
export const PAGE_COUNT_GUIDES: readonly { label: string; pages: number; hint: string }[] = [
  { label: '週刊連載', pages: 19, hint: '週刊少年誌の 1 話はおよそ 16〜20 ページ' },
  { label: '月刊連載', pages: 32, hint: '月刊誌の 1 話はおよそ 30〜45 ページ' },
  { label: '読切', pages: 31, hint: '新人賞や読切は 31 ページや 45 ページの枠が多い' },
  { label: '初回増ページ', pages: 50, hint: '週刊の第 1 話は 45〜55 ページ前後' },
]

const withTone = (tone: string, text: string) => {
  const t = tone.trim()
  return t === '' ? text : `（全体のトーン: ${t}）\n${text}`
}

/**
 * ページ割りの要求。PagePlanRequest にトーンの欄が無いので、トーンは脚本の頭に括弧書きで添える
 */
export function planRequest(project: Project, input: ScriptDraftInput): PagePlanRequest {
  return {
    project: { settings: project.settings, characters: project.characters },
    script: withTone(input.tone, input.script.trim()),
    ...(input.pageCount !== undefined && { pageCount: input.pageCount }),
  }
}

/** プロジェクトに居ないキャラと重複を `cast` から落とし、流れの前後の空白を落とす */
export function normalizePlan(plan: PagePlan, characters: readonly Character[]): PagePlan {
  return {
    note: plan.note.trim(),
    cast: plan.cast.filter(
      (id, i) => plan.cast.indexOf(id) === i && characters.some((c) => c.id === id),
    ),
  }
}

/** テンプレートのページに、ページ割りの流れと登場キャラを入れる。空の流れと登場キャラは項目ごと持たない */
export function plannedPage(
  plan: PagePlan,
  template: PageTemplate,
  direction: Project['settings']['direction'],
): Page {
  const note = plan.note.trim()
  return {
    ...createPage(template, direction),
    ...(note !== '' && { note }),
    ...(plan.cast.length > 0 && { cast: plan.cast }),
  }
}

/**
 * `run` を呼び、`signal` が abort されたらその時点で `signal.reason` で reject する。
 * LlmProvider は signal を受けないので、abort 後に届いた応答はここで捨てる
 */
export function abortable<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    run()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { fixtures, parseProject, newId } = await import('@manga/schema')

  test('parsePageCount', () => {
    expect(parsePageCount(' ')).toBeUndefined()
    expect(parsePageCount('3')).toBe(3)
    expect(parsePageCount('0')).toBeNull()
    expect(parsePageCount('1.5')).toBeNull()
    expect(parsePageCount(String(MAX_PAGE_COUNT + 1))).toBeNull()
    expect(parsePageCount('x')).toBeNull()
  })

  test('every page count guide is accepted by the page count field', () => {
    for (const g of PAGE_COUNT_GUIDES) expect(parsePageCount(String(g.pages))).toBe(g.pages)
  })

  test('planRequest sends settings, characters, page count and the tone with the script', () => {
    const project = fixtures.samplePage01
    expect(planRequest(project, { script: ' E「…」\n', tone: '', pageCount: 2 })).toEqual({
      project: { settings: project.settings, characters: project.characters },
      script: 'E「…」',
      pageCount: 2,
    })
    const req = planRequest(project, { script: 'E「…」', tone: ' 静か ' })
    expect(req.script).toBe('（全体のトーン: 静か）\nE「…」')
    expect('pageCount' in req).toBe(false)
  })

  test('normalizePlan drops unknown and repeated characters and trims the note', () => {
    const { characters } = fixtures.samplePage01
    expect(normalizePlan({ note: ' n ', cast: ['chr_e', 'chr_x', 'chr_e'] }, characters)).toEqual({
      note: 'n',
      cast: ['chr_e'],
    })
  })

  test('plannedPage puts the note and cast on a template page', () => {
    const project = fixtures.samplePage01
    const planned = plannedPage({ note: 'n', cast: ['chr_e'] }, '3rows', 'rtl')
    expect(planned).toMatchObject({ note: 'n', cast: ['chr_e'] })
    expect(planned.panels).toHaveLength(createPage('3rows', 'rtl').panels.length)
    const empty = plannedPage({ note: ' ', cast: [] }, '3rows', 'rtl')
    expect('cast' in empty || 'note' in empty).toBe(false)
    expect(() =>
      parseProject({
        ...project,
        episodes: [...project.episodes, { id: newId(), title: '', pages: [planned] }],
      }),
    ).not.toThrow()
  })

  describe('abortable', () => {
    test('resolves with the result and passes errors through', async () => {
      const signal = new AbortController().signal
      await expect(abortable(async () => 1, signal)).resolves.toBe(1)
      await expect(abortable(async () => Promise.reject(new Error('502')), signal)).rejects.toThrow(
        '502',
      )
    })

    test('rejects on abort and drops the result that arrives later', async () => {
      let respond: (n: number) => void = () => {}
      const run = vi.fn(
        () =>
          new Promise<number>((r) => {
            respond = r
          }),
      )
      const controller = new AbortController()
      const pending = abortable(run, controller.signal)
      controller.abort()
      respond(1)
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await expect(abortable(run, controller.signal)).rejects.toBeDefined()
      expect(run).toHaveBeenCalledTimes(1)
    })
  })
}
