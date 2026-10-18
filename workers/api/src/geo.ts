import { createMiddleware } from 'hono/factory'
import { ApiException } from './api-error'
import type { Env } from './env'

/** ALLOWED_COUNTRIES を ISO 3166-1 alpha-2 の大文字の一覧にする。空なら制限しない */
export function parseAllowedCountries(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c !== '')
}

/**
 * 接続元の国（Cloudflare が付ける `request.cf.country`）が ALLOWED_COUNTRIES に無ければ country_blocked にする。
 * 国が分からない要求も弾く。Tor（T1）や判定できない接続（XX）を通すと、制限を回り道できてしまうため
 */
export function requireAllowedCountry() {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const allowed = parseAllowedCountries(c.env.ALLOWED_COUNTRIES)
    if (allowed.length > 0) {
      const country = (c.req.raw.cf as { country?: unknown } | undefined)?.country
      if (typeof country !== 'string' || !allowed.includes(country.toUpperCase())) {
        throw new ApiException('country_blocked')
      }
    }
    await next()
  })
}
