import { env } from 'cloudflare:workers'
import { aiFixtures, createFakeLlmProvider, type LlmProvider } from '@manga/ai'
import type { LayoutSuggestionResponse } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { DEBUG_USER_HEADER } from '../src/user'

const request = { panels: aiFixtures.nameDraft.panels }

function post(app: ReturnType<typeof createApp>, body: unknown = request) {
  return app.request(
    '/v1/ai/suggest-layout',
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

/** suggestLayout が responses を順に返す LlmProvider。受け取った要求を記録する */
function scripted(responses: (() => Promise<LayoutSuggestionResponse>)[]) {
  const fake = createFakeLlmProvider()
  const calls: unknown[] = []
  const provider: LlmProvider = {
    ...fake,
    async suggestLayout(req) {
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

describe('POST /v1/ai/suggest-layout', () => {
  test('returns the fake suggestion and records usage', async () => {
    const res = await post(createApp())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(aiFixtures.layoutSuggestion)
    expect((await usageRows()).results).toEqual([{ kind: 'suggest-layout', cost_units: 1 }])
  })

  test('passes the validated request to the provider', async () => {
    const { provider, calls } = scripted([async () => aiFixtures.layoutSuggestion])
    expect((await post(createApp({ llmProvider: () => provider }))).status).toBe(200)
    expect(calls).toEqual([request])
  })

  test('400 on a body without name panels', async () => {
    const app = createApp()
    expect((await post(app, '{')).status).toBe(400)
    expect((await post(app, { panels: [] })).status).toBe(400)
    expect((await post(app, { panels: [{ note: '', lines: [] }] })).status).toBe(400)
    expect((await usageRows()).results).toHaveLength(0)
  })

  test('drops the options whose panels do not match the name, and retries when none is left', async () => {
    const [fits] = aiFixtures.layoutSuggestion.options
    if (!fits) throw new Error('fixture has no option')
    const short = { summary: 's', rows: [{ height: 1, panels: [{ width: 1 }] }] }
    const { provider, calls } = scripted([
      async () => ({ options: [short] }),
      async () => ({ options: [short, fits] }),
    ])
    const res = await post(createApp({ llmProvider: () => provider }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ options: [fits] })
    expect(calls).toHaveLength(2)
    expect((await usageRows()).results[0]?.cost_units).toBe(2)
  })

  test('retries an invalid suggestion, then 502 when the retry is invalid too', async () => {
    // スキーマを通らない応答。LlmProvider は返さずに throw する
    const invalid = async (): Promise<LayoutSuggestionResponse> => {
      throw new Error('invalid llm output')
    }
    const { provider, calls } = scripted([invalid, invalid])
    expect((await post(createApp({ llmProvider: () => provider }))).status).toBe(502)
    expect(calls).toHaveLength(2)
    expect((await usageRows()).results[0]?.cost_units).toBe(2)
  })
})
