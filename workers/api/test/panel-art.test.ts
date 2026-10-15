import { env } from 'cloudflare:workers'
import { createFakeImageProvider, type ImageProvider } from '@manga/ai'
import { fixtures } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { isDecodablePng } from '../src/png'

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

function post(app: ReturnType<typeof createApp>, token: string | null = 'test-token') {
  return app.request(
    '/v1/ai/panel-art',
    {
      method: 'POST',
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      body: panelArtBody(),
    },
    env,
  )
}

const usageRows = () =>
  env.DB.prepare('SELECT token_hash, kind, cost_units FROM ai_usage').all<{
    token_hash: string
    kind: string
    cost_units: number
  }>()

beforeEach(async () => {
  await env.DB.exec('DELETE FROM ai_usage')
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
    expect(results[0]).toMatchObject({ kind: 'panel-art', cost_units: 1 })
    expect(results[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('401 without a token or with a wrong token', async () => {
    const app = createApp()
    expect((await post(app, null)).status).toBe(401)
    expect((await post(app, 'nope')).status).toBe(401)
    expect((await usageRows()).results).toHaveLength(0)
  })

  test('400 when layout is missing', async () => {
    const form = panelArtBody()
    form.delete('layout')
    const res = await createApp().request(
      '/v1/ai/panel-art',
      { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: form },
      env,
    )
    expect(res.status).toBe(400)
  })

  test('retries once on an invalid image, then succeeds', async () => {
    const good = createFakeImageProvider()
    let calls = 0
    const flaky: ImageProvider = {
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
