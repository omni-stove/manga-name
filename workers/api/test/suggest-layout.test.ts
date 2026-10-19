import { env } from 'cloudflare:workers'
import { aiFixtures, createFakeLlmProvider, type LlmProvider } from '@manga/ai'
import { fixtures, type LayoutSuggestionResponse } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { DEBUG_USER_HEADER } from '../src/user'

const { settings, characters } = fixtures.samplePage01
const request = { project: { settings, characters }, script: 'E「……ここか」\n足元を見る。' }

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

  test('400 on a body without a page script', async () => {
    const app = createApp()
    expect((await post(app, '{')).status).toBe(400)
    expect((await post(app, { ...request, script: '  ' })).status).toBe(400)
    expect((await usageRows()).results).toHaveLength(0)
  })

  test('drops unknown speakers without retrying', async () => {
    const suggestion = async (): Promise<LayoutSuggestionResponse> => ({
      options: [
        {
          summary: 's',
          rows: [
            {
              height: 1,
              panels: [
                {
                  width: 1,
                  note: 'n',
                  lines: [
                    { speakerId: 'chr_e', text: 'a', shape: 'normal' },
                    { speakerId: 'chr_missing', text: 'b', shape: 'shout' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    const { provider, calls } = scripted([suggestion])
    const res = await post(createApp({ llmProvider: () => provider }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as LayoutSuggestionResponse
    expect(body.options[0]?.rows[0]?.panels[0]?.lines).toEqual([
      { speakerId: 'chr_e', text: 'a', shape: 'normal' },
      { text: 'b', shape: 'shout' },
    ])
    expect(calls).toHaveLength(1)
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
