import { createMiddleware } from 'hono/factory'
import type { Env } from './env'

export const DEBUG_USER_HEADER = 'x-debug-user'

/** 1 ユーザーあたりの上限（回 / RATE_LIMIT_WINDOW_MS） */
export const RATE_LIMIT_PER_MINUTE = 60
const RATE_LIMIT_WINDOW_MS = 60_000

const USER_ID = /^[\w.@+-]{1,128}$/

export type UserEnv = { Bindings: Env; Variables: { userId: string } }

/** X-Debug-User に使える文字列なら true */
export const isUserId = (value: string) => USER_ID.test(value)

/**
 * user の now を含む窓の要求数を 1 増やし、上限を超えていれば窓が明けるまでの秒数を返す。
 * 超えていなければ null。
 * 判定と加算を 1 文の UPSERT にしているのは、同時に届いた要求が同じ数を読んで両方通らないようにするため。
 */
async function hitRateLimit(db: D1Database, userId: string, now: number): Promise<number | null> {
  const windowStart = now - (now % RATE_LIMIT_WINDOW_MS)
  const [, hit] = await db.batch<{ count: number }>([
    db
      .prepare('DELETE FROM rate_limits WHERE user_id = ?1 AND window_start < ?2')
      .bind(userId, windowStart),
    db
      .prepare(
        `INSERT INTO rate_limits (user_id, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT (user_id, window_start) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(userId, windowStart),
  ])
  const count = hit?.results[0]?.count ?? 0
  if (count <= RATE_LIMIT_PER_MINUTE) return null
  return Math.ceil((windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000)
}

/**
 * X-Debug-User のユーザーを userId に入れ、ユーザーごとに RATE_LIMIT_PER_MINUTE を超えたら 429 にする。
 * WS-14 の認証ミドルウェアが userId を入れるまでの代替。
 */
export function requireUser(now: () => number) {
  return createMiddleware<UserEnv>(async (c, next) => {
    const userId = c.req.header(DEBUG_USER_HEADER)
    if (userId === undefined || !isUserId(userId)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const retryAfter = await hitRateLimit(c.env.DB, userId, now())
    if (retryAfter !== null) {
      return c.json({ error: 'rate limit exceeded' }, 429, { 'retry-after': String(retryAfter) })
    }
    c.set('userId', userId)
    await next()
  })
}
