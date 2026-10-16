import { env } from 'cloudflare:workers'
import { aiFixtures, createFakeLlmProvider, type LlmProvider } from '@manga/ai'
import { fixtures, type LayoutProposalResponse } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { DEBUG_USER_HEADER } from '../src/user'

const { settings, characters } = fixtures.samplePage01
const request = {
  project: { settings, characters },
  script: 'E「……」\n森を歩く。',
  pageCount: 1,
}

/** headers は認証のヘッダ。既定は開発時の X-Debug-User: alice */
function post(
  app: ReturnType<typeof createApp>,
  body: unknown = request,
  headers: Record<string, string> = { [DEBUG_USER_HEADER]: 'alice' },
) {
  return app.request(
    '/v1/ai/propose-layout',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
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

/** proposeLayout が responses を順に返す LlmProvider。呼ばれた回数と受け取った要求を記録する */
function scripted(responses: (() => Promise<LayoutProposalResponse>)[]) {
  const fake = createFakeLlmProvider()
  const calls: unknown[] = []
  const provider: LlmProvider = {
    async proposeLayout(req) {
      calls.push(req)
      const next = responses[calls.length - 1]
      if (!next) throw new Error('no more responses')
      return await next()
    },
    critique: fake.critique,
  }
  return { provider, calls }
}

const invalid = async () =>
  ({ pages: [{ id: 'tmp_pg_1' }], rationale: 'r' }) as unknown as LayoutProposalResponse

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ai_usage'),
    env.DB.prepare('DELETE FROM rate_limits'),
  ])
})

describe('POST /v1/ai/propose-layout', () => {
  test('returns the fake proposal and records usage', async () => {
    const res = await post(createApp())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(aiFixtures.layoutProposal)

    const { results } = await usageRows()
    expect(results).toEqual([{ kind: 'propose-layout', cost_units: 1 }])
  })

  test('passes the validated request to the provider', async () => {
    const { provider, calls } = scripted([async () => aiFixtures.layoutProposal])
    const res = await post(createApp({ llmProvider: () => provider }))
    expect(res.status).toBe(200)
    expect(calls).toEqual([request])
  })

  test('401 without a token or with a wrong token', async () => {
    const app = createApp()
    expect((await post(app, request, {})).status).toBe(401)
    expect((await post(app, request, { authorization: 'Bearer nope' })).status).toBe(401)
    expect((await usageRows()).results).toHaveLength(0)
  })

  test('400 on a body that is not JSON or not a LayoutProposalRequest', async () => {
    const app = createApp()
    expect((await post(app, '{')).status).toBe(400)
    expect((await post(app, { ...request, script: '  ' })).status).toBe(400)
    expect((await post(app, { ...request, pageCount: 0 })).status).toBe(400)
    expect((await post(app, { script: 's' })).status).toBe(400)
    expect((await usageRows()).results).toHaveLength(0)
  })

  test('retries once on an invalid proposal, then succeeds', async () => {
    const { provider, calls } = scripted([invalid, async () => aiFixtures.layoutProposal])
    const res = await post(createApp({ llmProvider: () => provider }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(aiFixtures.layoutProposal)
    expect(calls).toHaveLength(2)
    expect((await usageRows()).results[0]?.cost_units).toBe(2)
  })

  test('502 after the retry still returns an invalid proposal', async () => {
    const { provider, calls } = scripted([invalid, invalid])
    const res = await post(createApp({ llmProvider: () => provider }))
    expect(res.status).toBe(502)
    expect(calls).toHaveLength(2)
    expect((await usageRows()).results[0]?.cost_units).toBe(2)
  })

  test('502 when the provider throws twice', async () => {
    const fail = async (): Promise<LayoutProposalResponse> => {
      throw new Error('upstream down')
    }
    const { provider, calls } = scripted([fail, fail])
    const res = await post(createApp({ llmProvider: () => provider }))
    expect(res.status).toBe(502)
    expect(calls).toHaveLength(2)
  })

  test('429 on the 11th request within a minute', async () => {
    const app = createApp()
    for (let i = 0; i < 10; i++) expect((await post(app)).status).toBe(200)
    const res = await post(app)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
  })
})
