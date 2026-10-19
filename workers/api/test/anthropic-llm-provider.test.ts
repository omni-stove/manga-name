import { aiFixtures, prompts } from '@manga/ai'
import { diagnosePage } from '@manga/diagnosis'
import { fixtures, type JsonSchema, type Page } from '@manga/schema'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createAnthropicLlmProvider } from '../src/anthropic-llm-provider'

const { settings, characters } = fixtures.samplePage01
const planRequest = { project: { settings, characters }, script: '森を歩く。' }
const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
const critiqueRequest = { page, diagnosis: diagnosePage(page, settings) }

/** Messages API の streaming 応答。text を 1 つの text ブロックで返し、stopReason で止める */
function message(text: string, stopReason = 'end_turn') {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  ]
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

let fetchMock = vi.fn<typeof fetch>()

const sentBody = (i = 0) => {
  const init = fetchMock.mock.calls[i]?.[1]
  return JSON.parse(String(init?.body)) as Record<string, unknown> & {
    system: string
    messages: { role: string; content: string }[]
    output_config: { effort: string; format: { type: string; schema: unknown } }
  }
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createAnthropicLlmProvider', () => {
  test('planPages sends the prompts and the wrapped array schema to the Messages API with the key', async () => {
    const plan = [{ note: 'n', script: 's', cast: [], lines: [{ text: 't', shape: 'normal' }] }]
    fetchMock.mockResolvedValueOnce(message(JSON.stringify({ elements: plan })))
    const provider = createAnthropicLlmProvider({ apiKey: 'test-key' })
    expect(await provider.planPages(planRequest)).toEqual(plan)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(new Headers(init?.headers).get('x-api-key')).toBe('test-key')
    const { system, user, schema } = prompts.planPages(planRequest)
    const body = sentBody()
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 64_000, stream: true })
    expect(body.system).toBe(system)
    expect(body.messages).toEqual([{ role: 'user', content: user }])
    // SDK の変換は構造化出力が受け付けない制約（minLength など）を description に移すので、形だけを比べる
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
    expect(body.system).toBe(system)
    expect(body.messages[0]?.content).toBe(user)
    expect(body.output_config.format.schema).toMatchObject({ required: schema.required })
  })

  test('transcribeName sends its prompts and the object schema', async () => {
    const reply = aiFixtures.nameDraft
    fetchMock.mockResolvedValueOnce(message(JSON.stringify(reply)))
    const provider = createAnthropicLlmProvider({ apiKey: 'test-key' })
    expect(await provider.transcribeName(planRequest)).toEqual(reply)

    const { system, user, schema } = prompts.transcribeName(planRequest)
    const body = sentBody()
    expect(body.max_tokens).toBe(8_000)
    expect(body.system).toBe(system)
    expect(body.messages[0]?.content).toBe(user)
    expect(body.output_config.format.schema).toMatchObject({ required: schema.required })
  })

  test('suggestLayout sends its prompts and the object schema', async () => {
    const reply = aiFixtures.layoutSuggestion
    const layoutRequest = { panels: aiFixtures.nameDraft.panels }
    fetchMock.mockResolvedValueOnce(message(JSON.stringify(reply)))
    const provider = createAnthropicLlmProvider({ apiKey: 'test-key' })
    expect(await provider.suggestLayout(layoutRequest)).toEqual(reply)

    const { system, user, schema } = prompts.suggestLayout(layoutRequest)
    const body = sentBody()
    expect(body.max_tokens).toBe(4_000)
    expect(body.system).toBe(system)
    expect(body.messages[0]?.content).toBe(user)
    expect(body.output_config.format.schema).toMatchObject({ required: schema.required })
  })

  test('throws when the reply does not match the output schema', async () => {
    fetchMock.mockResolvedValueOnce(message('{"elements":[{"unexpected":true}]}'))
    const provider = createAnthropicLlmProvider({ apiKey: 'test-key' })
    await expect(provider.planPages(planRequest)).rejects.toThrow('invalid llm output')
  })

  test('throws when the reply stops before the end of the turn', async () => {
    fetchMock.mockResolvedValueOnce(message('{"summary":"s","suggestions":[]}', 'max_tokens'))
    const provider = createAnthropicLlmProvider({ apiKey: 'test-key' })
    await expect(provider.critique(critiqueRequest)).rejects.toThrow('max_tokens')
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
