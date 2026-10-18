import { prompts } from '@manga/ai'
import { diagnosePage } from '@manga/diagnosis'
import { fixtures, type JsonSchema, type Page } from '@manga/schema'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createAnthropicLlmProvider } from '../src/anthropic-llm-provider'

const { settings, characters } = fixtures.samplePage01
const planRequest = { project: { settings, characters }, script: '森を歩く。' }
const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
const critiqueRequest = { page, diagnosis: diagnosePage(page, settings) }

/** Messages API の応答。text は 1 つ目の text ブロックに入れる */
function message(text: string) {
  return Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  })
}

let fetchMock = vi.fn<typeof fetch>()

const sentBody = (i = 0) => {
  const init = fetchMock.mock.calls[i]?.[1]
  return JSON.parse(String(init?.body)) as Record<string, unknown> & {
    system: { type: string; text: string }[]
    messages: { role: string; content: { type: string; text: string }[] }[]
    output_config: { effort: string; format: { type: string; schema: unknown } }
  }
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  // workerd の TracingChannel.hasSubscribers は Node と違って関数なので、AI SDK は購読者が居なくても
  // tracePromise で包み、失敗した呼び出しごとに処理されない reject を残す。Node でないと名乗らせて包ませない
  const runtime = globalThis as unknown as { process: object }
  vi.stubGlobal(
    'process',
    Object.create(runtime.process, { release: { value: { name: 'workerd' } } }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createAnthropicLlmProvider', () => {
  test('planPages sends the prompts and the wrapped array schema to the Messages API with the key', async () => {
    const plan = [{ note: 'n', cast: [], lines: [] }]
    fetchMock.mockResolvedValueOnce(message(JSON.stringify({ elements: plan })))
    const provider = createAnthropicLlmProvider({ apiKey: 'test-key' })
    expect(await provider.planPages(planRequest)).toEqual(plan)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(new Headers(init?.headers).get('x-api-key')).toBe('test-key')
    const { system, user, schema } = prompts.planPages(planRequest)
    const body = sentBody()
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 32_000 })
    expect(body.system.map((b) => b.text).join('')).toBe(system)
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: user }] }])
    // AI SDK は Anthropic が受け付けない制約（minLength など）を description に移すので、形だけを比べる
    expect(body.output_config).toMatchObject({
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          required: ['elements'],
          properties: {
            elements: { type: 'array', items: { required: (schema.items as JsonSchema).required } },
          },
        },
      },
    })
  })

  test('critique sends its prompts with the smaller output limit', async () => {
    fetchMock.mockResolvedValueOnce(message('{"summary":"s","suggestions":[]}'))
    const provider = createAnthropicLlmProvider({ apiKey: 'test-key' })
    expect(await provider.critique(critiqueRequest)).toEqual({ summary: 's', suggestions: [] })

    const { system, user, schema } = prompts.critique(critiqueRequest)
    const body = sentBody()
    expect(body.max_tokens).toBe(8_000)
    expect(body.system.map((b) => b.text).join('')).toBe(system)
    expect(body.messages[0]?.content[0]?.text).toBe(user)
    expect(body.output_config.format.schema).toMatchObject({ required: schema.required })
  })

  test('returns the JSON as is without checking it against the schema', async () => {
    fetchMock.mockResolvedValueOnce(message('{"elements":[{"unexpected":true}]}'))
    const provider = createAnthropicLlmProvider({ apiKey: 'test-key' })
    expect(await provider.planPages(planRequest)).toEqual([{ unexpected: true }])
  })

  test('throws on an HTTP error without retrying', async () => {
    for (const status of [429, 500, 529]) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValue(
        Response.json(
          { type: 'error', error: { type: 'overloaded_error', message: 'busy' } },
          { status },
        ),
      )
      const provider = createAnthropicLlmProvider({ apiKey: 'test-key' })
      await expect(provider.critique(critiqueRequest), String(status)).rejects.toThrow()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  test('throws when the reply is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(message('I cannot do that.'))
    const provider = createAnthropicLlmProvider({ apiKey: 'test-key' })
    await expect(provider.planPages(planRequest)).rejects.toThrow()
  })

  test('throws when fetch itself fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'))
    const provider = createAnthropicLlmProvider({ apiKey: 'test-key' })
    await expect(provider.planPages(planRequest)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
