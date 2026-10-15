import { createEmptyProject, type Project, parseProject } from '@manga/schema'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import type { Env } from './env'
import { deleteProject, insertProject, listProjects, readProject, saveProject } from './project-store'

/** 1 Project JSON の上限（バイト） */
export const MAX_PROJECT_BYTES = 5 * 1024 * 1024

export const DEBUG_USER_HEADER = 'x-debug-user'

const USER_ID = /^[\w.@+-]{1,128}$/

const CreateProjectSchema = z.object({ title: z.string().trim().min(1).max(200) })

type ProjectsEnv = { Bindings: Env; Variables: { userId: string } }

const etag = (updatedAt: string) => `"${updatedAt}"`

/** If-Match の先頭の強い ETag から引用符を外して返す。形式が違えば null */
function parseIfMatch(header: string): string | null {
  return header.match(/^\s*"([^"]+)"/)?.[1] ?? null
}

function describeError(e: unknown) {
  if (e instanceof z.ZodError) return z.prettifyError(e)
  return e instanceof Error ? e.message : 'invalid request body'
}

/** 本文を MAX_PROJECT_BYTES まで読んで JSON として解釈する */
async function readJson(
  c: Context<ProjectsEnv>,
): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string }> {
  const tooLarge = { ok: false, status: 413, error: 'project exceeds 5MB' } as const
  // Content-Length で先に断るのは、上限を大きく超える本文をメモリに読み込まないため
  if (Number(c.req.header('content-length')) > MAX_PROJECT_BYTES) return tooLarge
  const body = await c.req.arrayBuffer()
  if (body.byteLength > MAX_PROJECT_BYTES) return tooLarge
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) }
  } catch {
    return { ok: false, status: 400, error: 'body is not valid JSON' }
  }
}

/**
 * `/v1/projects` 以下。X-Debug-User ヘッダのユーザーを owner とし、他人のプロジェクトは 404 にする。
 * GET / PUT は ETag に updated_at を載せ、PUT は If-Match が一致しないと 409。
 */
export function createProjectsApp() {
  const app = new Hono<ProjectsEnv>()

  // WS-14 の認証ミドルウェアが userId を入れるまでの代替
  app.use('*', async (c, next) => {
    const userId = c.req.header(DEBUG_USER_HEADER)
    if (userId === undefined || !USER_ID.test(userId)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    c.set('userId', userId)
    await next()
  })

  app.get('/', async (c) => {
    return c.json({ projects: await listProjects(c.env.DB, c.get('userId')) })
  })

  app.post('/', async (c) => {
    const body = await readJson(c)
    if (!body.ok) return c.json({ error: body.error }, body.status)
    const parsed = CreateProjectSchema.safeParse(body.value)
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)

    const project = createEmptyProject(parsed.data.title)
    await insertProject(c.env.DB, c.get('userId'), project, Date.now())
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

    const body = await readJson(c)
    if (!body.ok) return c.json({ error: body.error }, body.status)
    let project: Project
    try {
      project = parseProject(body.value)
    } catch (e) {
      return c.json({ error: describeError(e) }, 400)
    }
    if (project.id !== id) return c.json({ error: 'project id does not match the URL' }, 400)

    const result = await saveProject(c.env.DB, c.get('userId'), project, expected, Date.now())
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

  app.delete('/:id', async (c) => {
    const removed = await deleteProject(c.env.DB, c.get('userId'), c.req.param('id'))
    if (!removed) return c.json({ error: 'not found' }, 404)
    return c.body(null, 204)
  })

  return app
}
