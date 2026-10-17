import { createEmptyProject, type Project, parseProject } from '@manga/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { canEdit, changesOnlyScribbles, projectRole } from './access'
import { ApiException, parseOrThrow } from './api-error'
import { deleteAssetObjects } from './asset-store'
import { createAssetRoutes } from './assets'
import { readJson } from './body'
import { createMemberRoutes, removeMember } from './members'
import {
  deleteProject,
  insertProject,
  listProjects,
  readProject,
  saveProject,
} from './project-store'
import { PROJECT_ID_HEADER, ROLE_HEADER, USER_ID_HEADER } from './room'
import { issueSyncTicket, requireSyncUser } from './sync-ticket'
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
  readJson(
    request,
    MAX_PROJECT_BYTES,
    new ApiException('project_too_large', { params: { maxBytes: MAX_PROJECT_BYTES } }),
  )

/**
 * `/v1/projects` 以下。作ったユーザーを owner とし、参加していないプロジェクトは 404 にする。
 * 一覧は参加しているプロジェクトも自分の role 付きで返す。
 * GET / PUT は ETag に updated_at を載せ、PUT は If-Match が一致しないと 409。
 * PUT は owner と editor、commenter はページの scribbles だけを変える PUT を通し、それ以外は 403。
 * DELETE は owner ならプロジェクトを消し、参加者なら自分の参加を外す。
 * `GET /:id/sync` は WebSocket を ProjectRoom（y-websocket プロトコル）にロール付きでつなぐ。ヘッダのほか、
 * `POST /:id/sync-ticket` で発行した使い捨てのチケットを `?ticket=` で渡しても認証できる。
 * `/:id/assets` と参加者・招待（createMemberRoutes）も同じ認証とレート制限の下に置く。now は現在時刻（Unix ミリ秒）。
 */
export function createProjectsApp(now: () => number = Date.now) {
  const app = new Hono<UserEnv>()

  // requireUser より前に置くのは、ヘッダの無いブラウザの WebSocket をチケットで通すため
  app.get('/:id/sync', requireSyncUser(now), async (c) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      throw new ApiException('websocket_required')
    }
    const id = c.req.param('id')
    const userId = c.get('userId')
    const role = await projectRole(c.env.DB, userId, id)
    if (role === null) throw new ApiException('not_found')
    const headers = new Headers(c.req.raw.headers)
    headers.set(PROJECT_ID_HEADER, id)
    headers.set(USER_ID_HEADER, userId)
    headers.set(ROLE_HEADER, role)
    const room = c.env.PROJECT_ROOMS.get(c.env.PROJECT_ROOMS.idFromName(id))
    return room.fetch(c.req.url, { headers })
  })

  app.use('*', requireUser(now))

  app.post('/:id/sync-ticket', async (c) => {
    const id = c.req.param('id')
    const userId = c.get('userId')
    if ((await projectRole(c.env.DB, userId, id)) === null) throw new ApiException('not_found')
    const { ticket, expiresAt } = await issueSyncTicket(c.env.DB, id, userId, now())
    return c.json({ ticket, expiresAt: new Date(expiresAt).toISOString() }, 201)
  })

  app.get('/', async (c) => {
    return c.json({ projects: await listProjects(c.env.DB, c.get('userId')) })
  })

  app.post('/', async (c) => {
    const { title } = parseOrThrow(CreateProjectSchema, await readProjectJson(c.req.raw))
    const project = createEmptyProject(title)
    await insertProject(c.env.DB, c.get('userId'), project, now())
    return c.json(project, 201, {
      etag: etag(project.updatedAt),
      location: `/v1/projects/${project.id}`,
    })
  })

  app.get('/:id', async (c) => {
    const id = c.req.param('id')
    const found =
      (await projectRole(c.env.DB, c.get('userId'), id)) && (await readProject(c.env.DB, id))
    if (!found) throw new ApiException('not_found')
    return c.body(found.doc, 200, {
      'content-type': 'application/json; charset=utf-8',
      etag: etag(found.updatedAt),
    })
  })

  app.put('/:id', async (c) => {
    const id = c.req.param('id')
    const ifMatch = c.req.header('if-match')
    if (ifMatch === undefined) throw new ApiException('if_match_required')
    const expected = parseIfMatch(ifMatch)
    if (expected === null) {
      throw new ApiException('invalid_request', { detail: 'If-Match must be a strong ETag' })
    }

    const role = await projectRole(c.env.DB, c.get('userId'), id)
    if (role === null) throw new ApiException('not_found')
    if (role === 'viewer') throw new ApiException('edit_forbidden')

    const body = await readProjectJson(c.req.raw)
    let project: Project
    try {
      project = parseProject(body)
    } catch (e) {
      throw new ApiException('invalid_request', { detail: describeError(e) })
    }
    if (project.id !== id) {
      throw new ApiException('invalid_request', { detail: 'project id does not match the URL' })
    }

    if (!canEdit(role)) {
      // 版が If-Match と違えば saveProject が 409 にする。違う版と比べると他人の変更まで commenter の変更に数えてしまう
      const saved = await readProject(c.env.DB, id)
      if (saved && saved.updatedAt === expected && !changesOnlyScribbles(saved.doc, project)) {
        throw new ApiException('commenter_scribbles_only')
      }
    }
    const result = await saveProject(c.env.DB, project, expected, now())
    switch (result.status) {
      case 'saved':
        return c.json({ updatedAt: result.updatedAt }, 200, { etag: etag(result.updatedAt) })
      case 'conflict':
        throw new ApiException('conflict', {
          params: { updatedAt: result.updatedAt },
          headers: { etag: etag(result.updatedAt) },
        })
      case 'not-found':
        throw new ApiException('not_found')
    }
  })

  app.delete('/:id', async (c) => {
    const id = c.req.param('id')
    const userId = c.get('userId')
    const role = await projectRole(c.env.DB, userId, id)
    if (role === null) throw new ApiException('not_found')
    if (role !== 'owner') {
      await removeMember(c.env, id, userId)
      return c.body(null, 204)
    }
    const removed = await deleteProject(c.env.DB, userId, id)
    if (!removed) throw new ApiException('not_found')
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
  app.route('/', createMemberRoutes(now))

  return app
}
