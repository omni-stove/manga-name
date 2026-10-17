import { env } from 'cloudflare:workers'
import { createFakeImageProvider, type ImageProvider } from '@manga/ai'
import { fixtures } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { isDecodablePng } from '../src/png'
import { DEBUG_USER_HEADER } from '../src/user'

const page = fixtures.samplePage01.episodes[0]?.pages[0]
const panel = page?.panels[0]
if (!page || !panel) throw new Error('fixture has no panel')

const { settings, characters } = fixtures.samplePage01

function panelArtBody() {
  const form = new FormData()
  form.set('json', JSON.stringify({ project: { settings, characters }, page, panelId: panel?.id }))
  form.set('layout', new Blob(['layout'], { type: 'image/png' }), 'layout.png')
  return form
}

/** headers は認証のヘッダ。既定は開発時の X-Debug-User: alice */
function post(
  app: ReturnType<typeof createApp>,
  headers: Record<string, string> = { [DEBUG_USER_HEADER]: 'alice' },
) {
  return app.request(
    '/v1/ai/panel-art',
    {
      method: 'POST',
      headers,
      body: panelArtBody(),
    },
    env,
  )
}

const usageRows = () =>
  env.DB.prepare('SELECT user_id, kind, cost_units FROM ai_usage').all<{
    user_id: string
    kind: string
    cost_units: number
  }>()

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ai_usage'),
    env.DB.prepare('DELETE FROM rate_limits'),
  ])
})

describe('GET /v1/health', () => {
  test('responds without a token', async () => {
    const res = await createApp().request('/v1/health', {}, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('POST /v1/ai/panel-art', () => {
  test('returns a PNG from the fake provider and records usage', async () => {
    const res = await post(createApp())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-ai-provider')).toBe('fake')
    expect(isDecodablePng(new Uint8Array(await res.arrayBuffer()))).toBe(true)

    const { results } = await usageRows()
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({ user_id: 'alice', kind: 'panel-art', cost_units: 1 })
  })

  test('401 without a token or with a wrong token', async () => {
    const app = createApp()
    expect((await post(app, {})).status).toBe(401)
    expect((await post(app, { authorization: 'Bearer nope' })).status).toBe(401)
    expect((await usageRows()).results).toHaveLength(0)
  })

  test('400 when layout is missing', async () => {
    const form = panelArtBody()
    form.delete('layout')
    const res = await createApp().request(
      '/v1/ai/panel-art',
      { method: 'POST', headers: { [DEBUG_USER_HEADER]: 'alice' }, body: form },
      env,
    )
    expect(res.status).toBe(400)
  })

  test('retries once on an invalid image, then succeeds', async () => {
    const good = createFakeImageProvider()
    let calls = 0
    const flaky: ImageProvider = {
      ...good,
      async generatePanelArt(req) {
        calls++
        if (calls === 1) return { image: new Blob([]), provider: 'flaky', prompt: 'p' }
        return good.generatePanelArt(req)
      },
    }
    const res = await post(createApp({ imageProvider: () => flaky }))
    expect(res.status).toBe(200)
    expect(calls).toBe(2)
    expect((await usageRows()).results[0]?.cost_units).toBe(2)
  })

  test('502 after the retry still returns an invalid image', async () => {
    let calls = 0
    const broken: ImageProvider = {
      ...createFakeImageProvider(),
      async generatePanelArt() {
        calls++
        return { image: new Blob(['not a png']), provider: 'broken', prompt: 'p' }
      },
    }
    const res = await post(createApp({ imageProvider: () => broken }))
    expect(res.status).toBe(502)
    expect(calls).toBe(2)
  })

  test('429 on the 11th request within a minute', async () => {
    const app = createApp()
    for (let i = 0; i < 10; i++) expect((await post(app)).status).toBe(200)
    const res = await post(app)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
    expect((await usageRows()).results).toHaveLength(10)
  })

  test('concurrent requests over the limit never reach the provider', async () => {
    const fake = createFakeImageProvider()
    let calls = 0
    const counting: ImageProvider = {
      ...fake,
      async generatePanelArt(req) {
        calls++
        return fake.generatePanelArt(req)
      },
    }
    const app = createApp({ imageProvider: () => counting })
    const responses = await Promise.all(Array.from({ length: 15 }, () => post(app)))
    const statuses = responses.map((res) => res.status)
    expect(statuses.filter((s) => s === 200)).toHaveLength(10)
    expect(statuses.filter((s) => s === 429)).toHaveLength(5)
    expect(calls).toBe(10)
    expect((await usageRows()).results).toHaveLength(10)
  })
})

describe('POST /v1/ai/character-art', () => {
  const character = { id: 'c1', name: 'エル', shortName: 'L', appearance: '銀髪' }
  const request = (app: ReturnType<typeof createApp>, body: unknown) =>
    app.request(
      '/v1/ai/character-art',
      {
        method: 'POST',
        headers: { [DEBUG_USER_HEADER]: 'alice', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      env,
    )

  test('returns a PNG from the fake provider and records usage', async () => {
    const res = await request(createApp(), { project: { settings }, character })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(decodeURIComponent(res.headers.get('x-ai-prompt') ?? '')).toContain('エル: 銀髪')
    expect(isDecodablePng(new Uint8Array(await res.arrayBuffer()))).toBe(true)
    expect((await usageRows()).results).toEqual([
      { user_id: 'alice', kind: 'character-art', cost_units: 1 },
    ])
  })

  test('400 without a character, and nothing is recorded', async () => {
    const res = await request(createApp(), { project: { settings } })
    expect(res.status).toBe(400)
    expect((await usageRows()).results).toHaveLength(0)
  })

  test('502 after the retry still returns an invalid image', async () => {
    const broken: ImageProvider = {
      ...createFakeImageProvider(),
      async generateCharacterArt() {
        return { image: new Blob(['not a png']), provider: 'broken', prompt: 'p' }
      },
    }
    const res = await request(createApp({ imageProvider: () => broken }), {
      project: { settings },
      character,
    })
    expect(res.status).toBe(502)
    expect((await usageRows()).results[0]?.cost_units).toBe(2)
  })
})
