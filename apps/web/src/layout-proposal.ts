import type { LayoutProposalRequest, LayoutProposalResponse, LlmProvider } from '@manga/ai'
import { type ID, newId, type Page, type Panel, type Project, parseProject } from '@manga/schema'
import { errorMessage } from './route-error'

/** 「脚本から下書き」のモーダルで入れるもの */
interface ScriptDraftInput {
  script: string
  /** ページ数の目安。省くと LLM に任せる */
  pageCount?: number
  /** トーンのヒント。空なら送らない */
  tone: string
}

/** ページ数の目安に入れられる上限。1 回の応答に収まる量に抑える */
export const MAX_PAGE_COUNT = 32

/** ページ数の目安の欄を読む。空は undefined、1〜MAX_PAGE_COUNT の整数でなければ null */
export function parsePageCount(text: string): number | undefined | null {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  return Number.isInteger(n) && n >= 1 && n <= MAX_PAGE_COUNT ? n : null
}

/**
 * プロバイダに送る要求。LayoutProposalRequest にトーンの欄が無いので、トーンは脚本の頭に括弧書きで添える
 */
export function proposalRequest(project: Project, input: ScriptDraftInput): LayoutProposalRequest {
  const tone = input.tone.trim()
  const script = input.script.trim()
  return {
    project: { settings: project.settings, characters: project.characters },
    script: tone === '' ? script : `（全体のトーン: ${tone}）\n${script}`,
    ...(input.pageCount !== undefined && { pageCount: input.pageCount }),
  }
}

/**
 * `provider.proposeLayout` を呼び、`signal` が abort されたらその時点で `signal.reason` で reject する。
 * LlmProvider は signal を受けないので、abort 後に届いた応答はここで捨てる
 */
export function requestProposal(
  provider: LlmProvider,
  req: LayoutProposalRequest,
  signal: AbortSignal,
): Promise<LayoutProposalResponse> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    provider
      .proposeLayout(req)
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
  const { aiFixtures, createFakeLlmProvider } = await import('@manga/ai')
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

  test('proposalRequest sends settings, characters, page count and the tone with the script', () => {
    const project = fixtures.samplePage01
    expect(proposalRequest(project, { script: ' E「…」\n', tone: '', pageCount: 2 })).toEqual({
      project: { settings: project.settings, characters: project.characters },
      script: 'E「…」',
      pageCount: 2,
    })
    const req = proposalRequest(project, { script: 'E「…」', tone: ' 静か ' })
    expect(req.script).toBe('（全体のトーン: 静か）\nE「…」')
    expect('pageCount' in req).toBe(false)
  })

  describe('requestProposal', () => {
    const req = proposalRequest(fixtures.samplePage01, { script: 's', tone: '' })

    test('resolves with the provider response', async () => {
      const res = await requestProposal(createFakeLlmProvider(), req, new AbortController().signal)
      expect(res).toEqual(aiFixtures.layoutProposal)
    })

    test('rejects on abort and drops the response that arrives later', async () => {
      let respond: (r: LayoutProposalResponse) => void = () => {}
      const provider = {
        ...createFakeLlmProvider(),
        proposeLayout: vi.fn(
          () =>
            new Promise<LayoutProposalResponse>((r) => {
              respond = r
            }),
        ),
      }
      const controller = new AbortController()
      const pending = requestProposal(provider, req, controller.signal)
      controller.abort()
      respond(aiFixtures.layoutProposal)
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await expect(requestProposal(provider, req, controller.signal)).rejects.toBeDefined()
      expect(provider.proposeLayout).toHaveBeenCalledTimes(1)
    })

    test('passes provider errors through', async () => {
      const provider = {
        ...createFakeLlmProvider(),
        proposeLayout: async () => Promise.reject(new Error('502')),
      }
      await expect(requestProposal(provider, req, new AbortController().signal)).rejects.toThrow(
        '502',
      )
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
