import { env } from 'cloudflare:workers'
import { aiFixtures, createFakeLlmProvider, type LlmProvider } from '@manga/ai'
import { fixtures, type PagePlanResponse } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { DEBUG_USER_HEADER } from '../src/user'

const { settings, characters } = fixtures.samplePage01
const request = {
  project: { settings, characters },
  script: 'E「……」\n森を歩く。',
  pageCount: 2,
}

function post(app: ReturnType<typeof createApp>, body: unknown = request) {
  return app.request(
    '/v1/ai/plan-pages',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', [DEBUG_USER_HEADER]: 'alice' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env,
  )
}

const usageRows = () =>
  env.DB.prepare('SELECT kind, cost_units FROM ai_usage').all<{
    kind: string
    cost_units: number
  }>()

/** planPages が responses を順に返す LlmProvider。受け取った要求を記録する */
function scripted(responses: (() => Promise<PagePlanResponse>)[]) {
  const fake = createFakeLlmProvider()
  const calls: unknown[] = []
  const provider: LlmProvider = {
    ...fake,
    async planPages(req) {
      calls.push(req)
      const next = responses[calls.length - 1]
      if (!next) throw new Error('no more responses')
      return await next()
    },
  }
  return { provider, calls }
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ai_usage'),
    env.DB.prepare('DELETE FROM rate_limits'),
  ])
})

describe('POST /v1/ai/plan-pages', () => {
  test('returns the fake plan and records usage', async () => {
    const res = await post(createApp())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(aiFixtures.pagePlan)
    expect((await usageRows()).results).toEqual([{ kind: 'plan-pages', cost_units: 1 }])
  })

  test('passes the validated request to the provider', async () => {
    const { provider, calls } = scripted([async () => aiFixtures.pagePlan])
    expect((await post(createApp({ llmProvider: () => provider }))).status).toBe(200)
    expect(calls).toEqual([request])
  })

  test('400 on a body that is not a PagePlanRequest', async () => {
    const app = createApp()
    expect((await post(app, '{')).status).toBe(400)
    expect((await post(app, { ...request, script: '  ' })).status).toBe(400)
    expect((await usageRows()).results).toHaveLength(0)
  })

  test('retries a plan that names an unknown character, then succeeds', async () => {
    const unknown = async () => ({
      pages: [{ note: 'n', cast: ['chr_missing'], script: 's' }],
      rationale: 'r',
    })
    const { provider, calls } = scripted([unknown, async () => aiFixtures.pagePlan])
    const res = await post(createApp({ llmProvider: () => provider }))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(2)
    expect((await usageRows()).results[0]?.cost_units).toBe(2)
  })

  test('502 after the retry still returns an invalid plan', async () => {
    const empty = async () => ({ pages: [], rationale: 'r' })
    const { provider, calls } = scripted([empty, empty])
    expect((await post(createApp({ llmProvider: () => provider }))).status).toBe(502)
    expect(calls).toHaveLength(2)
  })
})
