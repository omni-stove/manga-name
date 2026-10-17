import { DisplayNameSchema } from '@manga/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { ApiException, parseOrThrow } from './api-error'
import { readJson } from './body'
import { requireUser, type UserEnv } from './user'

const UpdateMeSchema = z.object({ name: DisplayNameSchema })

/**
 * ログイン中のユーザー自身の API。
 * - `PUT /` `{ name }`: 表示名を変え、`{ name }` を返す。auth_users に行の無いユーザー（X-Debug-User）は not_found
 */
export function createMeApp(now: () => number) {
  const app = new Hono<UserEnv>()
  app.use('*', requireUser(now))

  app.put('/', async (c) => {
    const { name } = parseOrThrow(UpdateMeSchema, await readJson(c.req.raw, 1024))
    const { meta } = await c.env.DB.prepare(
      'UPDATE auth_users SET name = ?1, updatedAt = ?2 WHERE id = ?3',
    )
      .bind(name, new Date(now()).toISOString(), c.get('userId'))
      .run()
    if (meta.changes !== 1) throw new ApiException('not_found')
    return c.json({ name })
  })

  return app
}
