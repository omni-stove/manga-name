import { createEmptyProject, type Project, parseProject } from '@manga/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { deleteAssetObjects } from './asset-store'
import { createAssetRoutes } from './assets'
import { readJson } from './body'
import {
  deleteProject,
  insertProject,
  listProjects,
  projectExists,
  readProject,
  saveProject,
} from './project-store'
import { PROJECT_ID_HEADER } from './room'
import { requireUser, type UserEnv } from './user'

/** 1 Project JSON の上限（バイト） */
export const MAX_PROJECT_BYTES = 5 * 1024 * 1024

const CreateProjectSchema = z.object({ title: z.string().trim().min(1).max(200) })

const etag = (updatedAt: string) => `"${updatedAt}"`

/** If-Match の先頭の強い ETag から引用符を外して返す。形式が違えば null */
function parseIfMatch(header: string): string | null {
  return header.match(/^\s*"([^"]+)"/)?.[1] ?? null
}

function describeError(e: unknown) {
  if (e instanceof z.ZodError) return z.prettifyError(e)
  return e instanceof Error ? e.message : 'invalid request body'
}

const readProjectJson = (request: Request) =>
  readJson(request, MAX_PROJECT_BYTES, 'project exceeds 5MB')

/**
 * `/v1/projects` 以下。X-Debug-User ヘッダのユーザーを owner とし、他人のプロジェクトは 404 にする。
 * GET / PUT は ETag に updated_at を載せ、PUT は If-Match が一致しないと 409。
 * `GET /:id/sync` は WebSocket を ProjectRoom（y-websocket プロトコル）につなぐ。
 * `/:id/assets` 以下も同じ認証とレート制限の下に置く。now は現在時刻（Unix ミリ秒）。
 */
export function createProjectsApp(now: () => number = Date.now) {
  const app = new Hono<UserEnv>()

  app.use('*', requireUser(now))

  app.get('/', async (c) => {
    return c.json({ projects: await listProjects(c.env.DB, c.get('userId')) })
  })

  app.post('/', async (c) => {
    const body = await readProjectJson(c.req.raw)
    if (!body.ok) return c.json({ error: body.error }, body.status)
    const parsed = CreateProjectSchema.safeParse(body.value)
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)

    const project = createEmptyProject(parsed.data.title)
    await insertProject(c.env.DB, c.get('userId'), project, now())
    return c.json(project, 201, {
      etag: etag(project.updatedAt),
      location: `/v1/projects/${project.id}`,
    })
  })

  app.get('/:id', async (c) => {
    const found = await readProject(c.env.DB, c.get('userId'), c.req.param('id'))
    if (!found) return c.json({ error: 'not found' }, 404)
    return c.body(found.doc, 200, {
      'content-type': 'application/json; charset=utf-8',
      etag: etag(found.updatedAt),
    })
  })

  app.put('/:id', async (c) => {
    const id = c.req.param('id')
    const ifMatch = c.req.header('if-match')
    if (ifMatch === undefined) return c.json({ error: 'If-Match is required' }, 428)
    const expected = parseIfMatch(ifMatch)
    if (expected === null) return c.json({ error: 'If-Match must be a strong ETag' }, 400)

    const body = await readProjectJson(c.req.raw)
    if (!body.ok) return c.json({ error: body.error }, body.status)
    let project: Project
    try {
      project = parseProject(body.value)
    } catch (e) {
      return c.json({ error: describeError(e) }, 400)
    }
    if (project.id !== id) return c.json({ error: 'project id does not match the URL' }, 400)

    const result = await saveProject(c.env.DB, c.get('userId'), project, expected, now())
    switch (result.status) {
      case 'saved':
        return c.json({ updatedAt: result.updatedAt }, 200, { etag: etag(result.updatedAt) })
      case 'conflict':
        return c.json(
          { error: 'project was updated elsewhere', updatedAt: result.updatedAt },
          409,
          { etag: etag(result.updatedAt) },
        )
      case 'not-found':
        return c.json({ error: 'not found' }, 404)
    }
  })

  app.get('/:id/sync', async (c) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return c.json({ error: 'expected a WebSocket upgrade' }, 426)
    }
    const id = c.req.param('id')
    if (!(await projectExists(c.env.DB, c.get('userId'), id))) {
      return c.json({ error: 'not found' }, 404)
    }
    const headers = new Headers(c.req.raw.headers)
    headers.set(PROJECT_ID_HEADER, id)
    const room = c.env.PROJECT_ROOMS.get(c.env.PROJECT_ROOMS.idFromName(id))
    return room.fetch(c.req.url, { headers })
  })

  app.delete('/:id', async (c) => {
    const id = c.req.param('id')
    const removed = await deleteProject(c.env.DB, c.get('userId'), id)
    if (!removed) return c.json({ error: 'not found' }, 404)
    try {
      await c.env.PROJECT_ROOMS.get(c.env.PROJECT_ROOMS.idFromName(id)).purge()
    } catch (e) {
      // D1 から消えた時点で同期にはつなげないので削除は成功として返す。alarm が残っていれば、
      // そこで D1 に無いのを見て DO storage を消す
      console.error('failed to purge the sync room', id, e)
    }
    await deleteAssetObjects(c.env.ASSETS, id)
    return c.body(null, 204)
  })

  app.route('/', createAssetRoutes(now))

  return app
}
