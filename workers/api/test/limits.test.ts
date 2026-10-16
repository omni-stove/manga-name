import { env } from 'cloudflare:workers'
import { createFakeImageProvider, type ImageProvider } from '@manga/ai'
import { fixtures } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { parseMonthlyLimit } from '../src/usage'
import { DEBUG_USER_HEADER, RATE_LIMIT_PER_MINUTE } from '../src/user'

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0)
let clock = NOW

const monthlyLimit = parseMonthlyLimit(env.MONTHLY_GENERATION_LIMIT)

function countingProvider() {
  const fake = createFakeImageProvider()
  const provider: ImageProvider & { calls: number } = {
    calls: 0,
    async generatePanelArt(req) {
      provider.calls++
      return fake.generatePanelArt(req)
    },
  }
  return provider
}

let provider = countingProvider()
const app = createApp({ now: () => clock, imageProvider: () => provider })

const get = (path: string, user = 'alice') =>
  app.request(path, { headers: { [DEBUG_USER_HEADER]: user } }, env)

function generate(user = 'alice') {
  const page = fixtures.samplePage01.episodes[0]?.pages[0]
  const { settings, characters } = fixtures.samplePage01
  const form = new FormData()
  form.set(
    'json',
    JSON.stringify({ project: { settings, characters }, page, panelId: page?.panels[0]?.id }),
  )
  form.set('layout', new Blob(['layout'], { type: 'image/png' }), 'layout.png')
  return app.request(
    '/v1/ai/panel-art',
    {
      method: 'POST',
      headers: { [DEBUG_USER_HEADER]: user },
      body: form,
    },
    env,
  )
}

/** userId の ai_usage 行を、created_at を at にして count 件入れる */
async function seedUsage(userId: string, count: number, at: number) {
  await env.DB.prepare(
    `WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?3)
     INSERT INTO ai_usage (user_id, kind, cost_units, created_at)
     SELECT ?1, 'panel-art', 1, ?2 FROM n`,
  )
    .bind(userId, at, count)
    .run()
}

const usageCount = async () =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_usage').first<{ n: number }>())?.n

beforeEach(async () => {
  clock = NOW
  provider = countingProvider()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits'),
    env.DB.prepare('DELETE FROM ai_usage'),
  ])
})

describe('rate limit of 60 requests per minute per user', () => {
  test('the 61st request in a minute is 429, other users and the next minute are not', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      expect((await get('/v1/projects')).status).toBe(200)
    }
    const limited = await get('/v1/projects')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect((await get('/v1/usage')).status).toBe(429)

    expect((await get('/v1/projects', 'bob')).status).toBe(200)

    clock += 59_000
    const later = await get('/v1/projects')
    expect(later.status).toBe(429)
    expect(later.headers.get('retry-after')).toBe('1')

    clock = NOW + 60_000
    expect((await get('/v1/projects')).status).toBe(200)
  })

  test('concurrent requests never exceed the limit', async () => {
    const responses = await Promise.all(
      Array.from({ length: RATE_LIMIT_PER_MINUTE + 10 }, () => get('/v1/projects')),
    )
    const statuses = responses.map((r) => r.status)
    expect(statuses.filter((s) => s === 200)).toHaveLength(RATE_LIMIT_PER_MINUTE)
    expect(statuses.filter((s) => s === 429)).toHaveLength(10)
  })

  test('old windows are removed', async () => {
    await get('/v1/projects')
    clock += 5 * 60_000
    await get('/v1/projects')
    const { results } = await env.DB.prepare('SELECT window_start FROM rate_limits').all()
    expect(results).toHaveLength(1)
  })
})

describe('GET /v1/usage', () => {
  test('returns this month’s generations of the user and the limit', async () => {
    await seedUsage('alice', 3, NOW - 3_600_000)
    await seedUsage('alice', 5, Date.UTC(2026, 8, 30, 23, 59, 59))
    await seedUsage('bob', 2, NOW - 3_600_000)
    expect((await generate()).status).toBe(200)

    const res = await get('/v1/usage')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      month: '2026-10',
      generations: 4,
      limit: monthlyLimit,
      remaining: monthlyLimit - 4,
      resetsAt: '2026-11-01T00:00:00.000Z',
    })
  })

  test('401 without a user', async () => {
    expect((await app.request('/v1/usage', {}, env)).status).toBe(401)
  })
})

describe('monthly generation limit', () => {
  test('a generation over the monthly limit is 402 and never reaches the provider', async () => {
    await seedUsage('alice', monthlyLimit - 1, NOW - 3_600_000)
    expect((await generate()).status).toBe(200)
    expect(provider.calls).toBe(1)

    const res = await generate()
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({
      limit: monthlyLimit,
      resetsAt: '2026-11-01T00:00:00.000Z',
    })
    expect(provider.calls).toBe(1)
    expect(await usageCount()).toBe(monthlyLimit)

    const usage = (await (await get('/v1/usage')).json()) as { remaining: number }
    expect(usage.remaining).toBe(0)
  })

  test('the limit is per user and resets in the next month', async () => {
    await seedUsage('alice', monthlyLimit, NOW - 3_600_000)
    expect((await generate()).status).toBe(402)
    expect((await generate('bob')).status).toBe(200)

    clock = Date.UTC(2026, 10, 1, 0, 0, 0)
    expect((await generate()).status).toBe(200)
  })

  test('402 takes precedence over the per-minute limit', async () => {
    await seedUsage('alice', monthlyLimit, NOW - 1_000)
    expect((await generate()).status).toBe(402)
  })

  test('401 on a malformed X-Debug-User', async () => {
    expect((await generate('a b')).status).toBe(401)
  })
})

describe('CORS', () => {
  const preflight = (origin: string) =>
    app.request(
      '/v1/projects',
      {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'if-match, x-debug-user, content-type',
        },
      },
      env,
    )

  test('allows apps/web and tauri://localhost', async () => {
    for (const origin of ['http://localhost:5173', 'tauri://localhost']) {
      const res = await preflight(origin)
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe(origin)
      expect(res.headers.get('access-control-allow-headers')).toContain('if-match')
    }
    const res = await get('/v1/projects')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('does not allow other origins', async () => {
    const res = await preflight('https://evil.example')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('exposes ETag to apps/web', async () => {
    const res = await app.request(
      '/v1/projects',
      { headers: { origin: 'http://localhost:5173', [DEBUG_USER_HEADER]: 'alice' } },
      env,
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(res.headers.get('access-control-expose-headers')).toContain('etag')
  })
})
