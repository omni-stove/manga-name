import { env } from 'cloudflare:workers'
import { describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { parseAllowedCountries } from '../src/geo'
import { DEBUG_USER_HEADER } from '../src/user'

const app = createApp()

const get = (path: string, country: string | undefined, allowed = 'JP') =>
  app.request(
    path,
    {
      headers: { [DEBUG_USER_HEADER]: 'alice' },
      ...(country !== undefined ? { cf: { country } } : {}),
    } as RequestInit,
    { ...env, ALLOWED_COUNTRIES: allowed },
  )

describe('parseAllowedCountries', () => {
  test('splits, trims and upper-cases', () => {
    expect(parseAllowedCountries(' jp, US ,,')).toEqual(['JP', 'US'])
    expect(parseAllowedCountries('')).toEqual([])
    expect(parseAllowedCountries(undefined)).toEqual([])
  })
})

describe('country restriction', () => {
  test('an allowed country passes', async () => {
    expect((await get('/v1/usage', 'JP')).status).toBe(200)
  })

  test('another country, Tor and an unknown country are blocked', async () => {
    for (const country of ['US', 'T1', 'XX', undefined]) {
      const res = await get('/v1/usage', country)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ code: 'country_blocked' })
    }
  })

  test('health is reachable from anywhere', async () => {
    expect((await get('/v1/health', 'US')).status).toBe(200)
  })

  test('an empty list does not restrict', async () => {
    expect((await get('/v1/usage', 'US', '')).status).toBe(200)
  })
})
