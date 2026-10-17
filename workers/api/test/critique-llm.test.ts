/**
 * 実プロバイダ（Anthropic `claude-haiku-5-5`）に critique をさせ、提案 Patch を当てると
 * diagnosePage の miss が減ることを確かめる。
 * 1 回ごとに課金されるので、`ANTHROPIC_API_KEY=... pnpm --filter @manga/api test critique-llm` のように
 * シェルからキーを渡したときだけ走る。
 */
import { env } from 'cloudflare:workers'
import { checkCritiquePatch } from '@manga/ai'
import { diagnosePage } from '@manga/diagnosis'
import { CritiqueResponseSchema, fixtures, type Page, type Patch } from '@manga/schema'
import { beforeEach, expect, test } from 'vitest'
import { createAnthropicLlmProvider } from '../src/anthropic-llm-provider'
import { createApp } from '../src/app'
import { DEBUG_USER_HEADER } from '../src/user'

const apiKey = (env as unknown as { TEST_ANTHROPIC_API_KEY?: string }).TEST_ANTHROPIC_API_KEY
const settings = fixtures.samplePage01.settings

/** 診断の単体テストと同じく、Panel 4 の E crouched を経路から外して miss を 1 つ作ったページ */
function pageWithMiss(): Page {
  const page = structuredClone(fixtures.samplePage01.episodes[0]?.pages[0]) as Page
  const focus = page.panels.find((p) => p.id === 'pn_4')?.focusPoints.find((f) => f.id === 'fp_4_e')
  if (!focus) throw new Error('fixture has no fp_4_e')
  focus.pos = { ...focus.pos, y: 0.95 }
  return page
}

/**
 * checkCritiquePatch を通ったページ根の Patch を page の複製に当てる。
 * 通るのは pos の replace とベクトルの add だけなので、その 2 つだけを解く
 */
function applyPagePatch(page: Page, patch: Patch): Page {
  const next = structuredClone(page)
  for (const op of patch) {
    const keys = op.path
      .split('/')
      .slice(1)
      .map((k) => k.replaceAll('~1', '/').replaceAll('~0', '~'))
    const last = keys.pop()
    let parent: unknown = next
    for (const key of keys) parent = (parent as Record<string, unknown>)[key]
    if (last === undefined || typeof parent !== 'object' || parent === null) {
      throw new Error(`cannot resolve ${op.path}`)
    }
    if (op.op === 'add' && Array.isArray(parent)) {
      parent.splice(last === '-' ? parent.length : Number(last), 0, op.value)
    } else if (op.op === 'replace') {
      ;(parent as Record<string, unknown>)[last] = op.value
    } else {
      throw new Error(`unexpected ${op.op} ${op.path}`)
    }
  }
  return next
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ai_usage'),
    env.DB.prepare('DELETE FROM rate_limits'),
  ])
})

test.runIf(apiKey)(
  'applying the real critique patches reduces the miss count of diagnosePage',
  { timeout: 120_000 },
  async () => {
    const page = pageWithMiss()
    const before = diagnosePage(page, settings)
    expect(before.summary.miss).toBe(1)

    const app = createApp({
      llmProvider: () => createAnthropicLlmProvider({ apiKey: apiKey as string }),
    })
    const res = await app.request(
      '/v1/ai/critique',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', [DEBUG_USER_HEADER]: 'alice' },
        body: JSON.stringify({ page, diagnosis: before }),
      },
      env,
    )
    expect(res.status).toBe(200)
    const critique = CritiqueResponseSchema.parse(await res.json())

    // エディタで上から順に「適用」を押すのと同じく、提案を 1 件ずつ今のページに照らして当てる
    let current = page
    const rejected: string[] = []
    for (const suggestion of critique.suggestions) {
      const checked = checkCritiquePatch(current, suggestion.patch)
      if (checked.ok) current = applyPagePatch(current, checked.patch)
      else rejected.push(`${suggestion.message}: ${checked.reason}`)
    }

    const after = diagnosePage(current, settings)
    expect(
      after.summary.miss,
      `summary: ${critique.summary}\nrejected:\n${rejected.join('\n')}`,
    ).toBeLessThan(before.summary.miss)
    expect(current.panels.map((p) => p.rect)).toEqual(page.panels.map((p) => p.rect))
  },
)
