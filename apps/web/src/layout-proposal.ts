import type { LayoutProposalRequest, PagePlanRequest } from '@manga/ai'
import {
  type Character,
  createPage,
  type ID,
  newId,
  type Page,
  type PagePlan,
  type PageTemplate,
  type Panel,
  type Project,
  parseProject,
} from '@manga/schema'
import { errorMessage } from './route-error'

/** 「脚本から下書き」のモーダルで入れるもの */
interface ScriptDraftInput {
  script: string
  /** 脚本を割り振るページ数。省くと LLM に任せる */
  pageCount?: number
  /** トーンのヒント。空なら送らない */
  tone: string
}

/** コマ割りの 1 要求に入れるページ数。1 ページずつ送ると、Workers の分あたりの上限（10 回）にすぐ当たる */
export const LAYOUT_CHUNK_SIZE = 4

/** ページ数に入れられる上限。ページ割り 1 回とコマ割り（LAYOUT_CHUNK_SIZE ずつ）が分あたりの上限に収まる量 */
export const MAX_PAGE_COUNT = 32

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
  {
    label: '初回増ページ（半分）',
    pages: 24,
    hint: '週刊の第 1 話は 45〜55 ページ前後。上限を超えるので、脚本を前後に分けて 2 回作る',
  },
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

/** プロジェクトに居ないキャラを `cast` から落とし、流れと抜き書きの前後の空白を落とす */
export function normalizePlan(plan: PagePlan, characters: readonly Character[]): PagePlan {
  return {
    note: plan.note.trim(),
    cast: plan.cast.filter(
      (id, i) => plan.cast.indexOf(id) === i && characters.some((c) => c.id === id),
    ),
    script: plan.script.trim(),
  }
}

/** ページ割りを LAYOUT_CHUNK_SIZE ずつに分けたときの、各まとまりの先頭の添字 */
export function layoutChunks(count: number): number[] {
  return Array.from(
    { length: Math.ceil(count / LAYOUT_CHUNK_SIZE) },
    (_, i) => i * LAYOUT_CHUNK_SIZE,
  )
}

/**
 * `plans` のページのコマ割りの要求。ページ割りで決めた流れと抜き書きを、ページ番号つきで脚本として送り、
 * ページ数をその枚数に固定する。`firstNumber` は `plans[0]` のページ番号
 */
export function layoutRequest(
  project: Project,
  plans: readonly PagePlan[],
  tone: string,
  firstNumber: number,
): LayoutProposalRequest {
  const script = plans
    .map((plan, i) => `【${firstNumber + i} ページ目】${plan.note}\n${plan.script}`)
    .join('\n\n')
  return {
    project: { settings: project.settings, characters: project.characters },
    script: withTone(tone, script),
    pageCount: plans.length,
  }
}

/**
 * コマ割りのページに、ページ割りの流れと登場キャラを入れる。LLM の返した note と cast より人の確かめた割り振りを採る。
 * 空の流れと登場キャラは項目ごと持たない
 */
export function withPlan(page: Page, plan: PagePlan): Page {
  const { cast: _, note: __, ...rest } = page
  const note = plan.note.trim()
  return {
    ...rest,
    ...(note !== '' && { note }),
    ...(plan.cast.length > 0 && { cast: plan.cast }),
  }
}

/** コマ割りをせず、テンプレートのページにページ割りの流れと登場キャラだけを入れる */
export function plannedPage(
  plan: PagePlan,
  template: PageTemplate,
  direction: Project['settings']['direction'],
): Page {
  return withPlan(createPage(template, direction), plan)
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

// 確かめるページは末尾の仮エピソードの 1 ページ目に置くので、issue のパスからその分を落とす
const PROPOSED_PAGE_PATH = /^episodes\.\d+\.pages\.0\./gm

/**
 * 提案のページを `project` に足したものが parseProject を通るか確かめる。
 * 通れば undefined、通らなければページを root にした「パス: 理由」の行
 */
export function checkProposedPage(project: Project, page: Page): string | undefined {
  try {
    parseProject({
      ...project,
      episodes: [...project.episodes, { id: newId(), title: '', pages: [page] }],
    })
    return undefined
  } catch (e) {
    return errorMessage(e).replace(PROPOSED_PAGE_PATH, '')
  }
}

function panelWithNewIds(panel: Panel): Panel {
  // 絵は提案に実体が無いので持ち込まない
  const { artId: _, ...rest } = panel
  const ids = new Map<ID, ID>()
  const fresh = (id: ID) => {
    const next = newId()
    ids.set(id, next)
    return next
  }
  const bubbles = panel.bubbles.map((b) => ({ ...b, id: fresh(b.id) }))
  const focusPoints = panel.focusPoints.map((f) => ({ ...f, id: fresh(f.id) }))
  // 知らない参照は残し、parseProject に弾かせる
  const remap = (id: ID) => ids.get(id) ?? id
  const vectors = panel.vectors.map((v) => ({
    ...v,
    id: newId(),
    ...(v.sourceFocusId !== undefined && { sourceFocusId: remap(v.sourceFocusId) }),
    ...(v.targetFocusId !== undefined && { targetFocusId: remap(v.targetFocusId) }),
  }))
  return { ...rest, id: newId(), bubbles, focusPoints, vectors, arts: [] }
}

/**
 * 提案のページの ID を全部 `newId()` で振り直す。ベクトルの焦点とフキダシへの参照は振り直した先に付け替え、
 * キャラクターへの参照はそのまま残す。提案には絵と参考画像の実体が無いので、arts、artId、reference は落とす
 */
export function pageWithNewIds(page: Page): Page {
  const { reference: _, ...rest } = page
  return {
    ...rest,
    id: newId(),
    panels: page.panels.map(panelWithNewIds),
    scribbles: page.scribbles.map((s) => ({ ...s, id: newId() })),
  }
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest
  const { aiFixtures } = await import('@manga/ai')
  const { createEmptyProject, fixtures } = await import('@manga/schema')

  const proposed = () => {
    const page = structuredClone(aiFixtures.layoutProposal.pages[0])
    if (!page) throw new Error('fixture に提案ページがない')
    return page
  }
  const allIds = (page: Page) => [
    page.id,
    ...page.scribbles.map((s) => s.id),
    ...page.panels.flatMap((p) => [
      p.id,
      ...p.bubbles.map((b) => b.id),
      ...p.focusPoints.map((f) => f.id),
      ...p.vectors.map((v) => v.id),
    ]),
  ]

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

  test('the largest plan fits the per-minute limit of 10 requests with the plan request', () => {
    expect(1 + layoutChunks(MAX_PAGE_COUNT).length).toBeLessThanOrEqual(10)
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

  test('normalizePlan drops unknown and repeated characters and trims the text', () => {
    const { characters } = fixtures.samplePage01
    expect(
      normalizePlan({ note: ' n ', cast: ['chr_e', 'chr_x', 'chr_e'], script: ' s\n' }, characters),
    ).toEqual({ note: 'n', cast: ['chr_e'], script: 's' })
  })

  test('layoutChunks splits pages by LAYOUT_CHUNK_SIZE', () => {
    expect(layoutChunks(0)).toEqual([])
    expect(layoutChunks(LAYOUT_CHUNK_SIZE)).toEqual([0])
    expect(layoutChunks(LAYOUT_CHUNK_SIZE + 1)).toEqual([0, LAYOUT_CHUNK_SIZE])
  })

  test('layoutRequest numbers the pages, fixes the page count and keeps the tone', () => {
    const project = fixtures.samplePage01
    const plans = aiFixtures.pagePlan.pages
    const req = layoutRequest(project, plans, '静か', 5)
    expect(req.pageCount).toBe(plans.length)
    expect(req.script).toBe(
      [
        '（全体のトーン: 静か）',
        `【5 ページ目】${plans[0]?.note}`,
        plans[0]?.script,
        '',
        `【6 ページ目】${plans[1]?.note}`,
        plans[1]?.script,
      ].join('\n'),
    )
  })

  test('withPlan and plannedPage take the note and cast from the plan', () => {
    const page = { ...proposed(), note: 'llm', cast: ['chr_x'] }
    expect(withPlan(page, { note: 'n', cast: ['chr_e'], script: 's' })).toMatchObject({
      note: 'n',
      cast: ['chr_e'],
    })
    const empty = withPlan(page, { note: ' ', cast: [], script: 's' })
    expect('cast' in empty || 'note' in empty).toBe(false)
    const planned = plannedPage({ note: 'n', cast: ['chr_e'], script: 's' }, '3rows', 'rtl')
    expect(planned.panels).toHaveLength(createPage('3rows', 'rtl').panels.length)
    expect(checkProposedPage(fixtures.samplePage01, planned)).toBeUndefined()
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

  describe('checkProposedPage', () => {
    test('accepts a page whose characters exist in the project', () => {
      expect(checkProposedPage(fixtures.samplePage01, proposed())).toBeUndefined()
    })

    test('reports unknown characters with paths from the page', () => {
      const message = checkProposedPage(createEmptyProject('t'), proposed())
      expect(message).toMatch(/^panels\.0\.focusPoints\.1\.characterId: /m)
      expect(message).toMatch(/^panels\.1\.bubbles\.0\.speakerId: /m)
      expect(message).not.toContain('episodes.')
    })
  })

  describe('pageWithNewIds', () => {
    test('replaces every id and keeps the content', () => {
      const page = proposed()
      const next = pageWithNewIds(page)
      const before = allIds(page)
      const after = allIds(next)
      expect(after).toHaveLength(before.length)
      expect(new Set(after).size).toBe(after.length)
      for (const id of after) expect(before).not.toContain(id)
      expect(next.panels.map((p) => p.bubbles.map((b) => b.text))).toEqual(
        page.panels.map((p) => p.bubbles.map((b) => b.text)),
      )
      expect(next.panels[0]?.focusPoints[1]?.characterId).toBe('chr_e')
      expect(checkProposedPage(fixtures.samplePage01, next)).toBeUndefined()
    })

    test('points vector references at the renamed focus points and bubbles', () => {
      const next = pageWithNewIds(proposed())
      for (const panel of next.panels) {
        const targets = new Set([...panel.focusPoints, ...panel.bubbles].map((t) => t.id))
        for (const v of panel.vectors) {
          if (v.targetFocusId !== undefined) expect(targets).toContain(v.targetFocusId)
          if (v.sourceFocusId !== undefined) expect(targets).toContain(v.sourceFocusId)
        }
      }
      expect(next.panels[0]?.vectors[0]?.targetFocusId).toBe(next.panels[0]?.focusPoints[1]?.id)
    })

    test('drops arts, artId and reference, and leaves unknown references to the schema', () => {
      const page = proposed()
      const panel = page.panels[0] as Panel
      panel.arts = [
        { id: 'a', ref: 'r', provider: 'p', prompt: '', createdAt: '2026-01-01T00:00:00.000Z' },
      ]
      panel.artId = 'a'
      page.reference = { ref: 'r', opacity: 0.5, visible: true }
      const vector = panel.vectors[0]
      if (!vector) throw new Error('fixture のコマ 1 にベクトルがない')
      vector.sourceFocusId = 'tmp_missing'

      const next = pageWithNewIds(page)
      expect(next.reference).toBeUndefined()
      expect(next.panels[0]?.arts).toEqual([])
      expect(next.panels[0]?.artId).toBeUndefined()
      expect(next.panels[0]?.vectors[0]?.sourceFocusId).toBe('tmp_missing')
      expect(checkProposedPage(fixtures.samplePage01, next)).toMatch(/sourceFocusId/)
    })
  })
}
