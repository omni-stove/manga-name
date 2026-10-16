import { env } from 'cloudflare:workers'
import { aiFixtures, createFakeLlmProvider, type LlmProvider } from '@manga/ai'
import { type CritiqueResponse, fixtures, type Page, type PageDiagnosis } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { DEBUG_USER_HEADER } from '../src/user'

const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
const diagnosis: PageDiagnosis = {
  pageId: page.id,
  readingOrderOk: true,
  inferredOrder: page.panels.map((p) => p.id),
  panels: [],
  bubbleChain: [],
  summary: { total: 0, ok: 0, weak: 0, miss: 0 },
  issues: [],
}
const request = { page, diagnosis }

/** headers は認証のヘッダ。既定は開発時の X-Debug-User: alice */
function post(
  app: ReturnType<typeof createApp>,
  body: unknown = request,
  headers: Record<string, string> = { [DEBUG_USER_HEADER]: 'alice' },
) {
  return app.request(
    '/v1/ai/critique',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
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

/** critique が responses を順に返す LlmProvider。呼ばれた回数と受け取った要求を記録する */
function scripted(responses: (() => Promise<CritiqueResponse>)[]) {
  const fake = createFakeLlmProvider()
  const calls: unknown[] = []
  const provider: LlmProvider = {
    proposeLayout: fake.proposeLayout,
    async critique(req) {
      calls.push(req)
      const next = responses[calls.length - 1]
      if (!next) throw new Error('no more responses')
      return await next()
    },
  }
  return { provider, calls }
}

const invalid = async () =>
  ({ summary: 's', suggestions: [{ message: 'm' }] }) as unknown as CritiqueResponse

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ai_usage'),
    env.DB.prepare('DELETE FROM rate_limits'),
  ])
})

describe('POST /v1/ai/critique', () => {
  test('returns the fake critique and records usage', async () => {
    const res = await post(createApp())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(aiFixtures.critique)
    expect((await usageRows()).results).toEqual([{ kind: 'critique', cost_units: 1 }])
  })

  test('passes the validated request to the provider', async () => {
    const { provider, calls } = scripted([async () => aiFixtures.critique])
    const res = await post(createApp({ llmProvider: () => provider }))
    expect(res.status).toBe(200)
    expect(calls).toEqual([request])
  })

  test('401 without a token', async () => {
    expect((await post(createApp(), request, {})).status).toBe(401)
    expect((await usageRows()).results).toHaveLength(0)
  })

  test('400 on a body that is not JSON, not a CritiqueRequest, or for another page', async () => {
    const app = createApp()
    expect((await post(app, '{')).status).toBe(400)
    expect((await post(app, { page })).status).toBe(400)
    expect((await post(app, { page: { id: 'pg' }, diagnosis })).status).toBe(400)
    expect((await post(app, { page, diagnosis: { ...diagnosis, pageId: 'other' } })).status).toBe(
      400,
    )
    expect((await usageRows()).results).toHaveLength(0)
  })

  test('413 on a body over the limit', async () => {
    const huge = { ...page, note: 'x'.repeat(300 * 1024) }
    const res = await post(createApp(), { page: huge, diagnosis })
    expect(res.status).toBe(413)
    expect((await usageRows()).results).toHaveLength(0)
  })

  test('retries once on an invalid critique, then succeeds', async () => {
    const { provider, calls } = scripted([invalid, async () => aiFixtures.critique])
    const res = await post(createApp({ llmProvider: () => provider }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(aiFixtures.critique)
    expect(calls).toHaveLength(2)
    expect((await usageRows()).results[0]?.cost_units).toBe(2)
  })

  test('502 when the provider keeps failing', async () => {
    const fail = async (): Promise<CritiqueResponse> => {
      throw new Error('upstream down')
    }
    const { provider, calls } = scripted([invalid, fail])
    const res = await post(createApp({ llmProvider: () => provider }))
    expect(res.status).toBe(502)
    expect(calls).toHaveLength(2)
    expect((await usageRows()).results[0]?.cost_units).toBe(2)
  })
})
