import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { MEMBER_ROLES, type ProjectRole, projectRole, userEmail } from './access'
import { ApiException, parseOrThrow } from './api-error'
import { readJson } from './body'
import type { Env } from './env'
import { hashToken, newToken } from './token'
import { requireUser, type UserEnv } from './user'

/** 招待リンクの有効期間 */
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000

const InviteSchema = z.object({
  email: z.email().max(320),
  role: z.enum(MEMBER_ROLES),
})

const RoleSchema = z.object({ role: z.enum(MEMBER_ROLES) })

const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** プロジェクトの同期サーバに、user の接続を閉じさせる。新しいロールでつなぎ直させるため */
async function revokeSync(env: Env, projectId: string, userId: string) {
  try {
    await env.PROJECT_ROOMS.get(env.PROJECT_ROOMS.idFromName(projectId)).revoke(userId)
  } catch (e) {
    // D1 のロールは既に変わっている。残った接続はつなぎ直すまで古いロールのまま
    console.error('failed to revoke sync connections', projectId, userId, e)
  }
}

/** user のプロジェクトへの参加を外し、同期の接続を閉じる。外したら true */
export async function removeMember(env: Env, projectId: string, userId: string) {
  const { meta } = await env.DB.prepare(
    'DELETE FROM project_members WHERE project_id = ?1 AND user_id = ?2',
  )
    .bind(projectId, userId)
    .run()
  await revokeSync(env, projectId, userId)
  return meta.changes === 1
}

interface MemberRow {
  userId: string
  role: ProjectRole
  email: string | null
  name: string | null
}

/**
 * `/v1/projects/:id` の参加者と招待。requireUser の後ろに置き、参加していないプロジェクトは 404 にする。
 * - `GET /:id/members`: 自分の role、owner を先頭にした参加者、owner には未使用の招待も
 * - `POST /:id/invites` `{ email, role }`: 招待を作り、リンクに載せるトークンを 1 度だけ返す。同じメールアドレスの古い招待は消す
 * - `DELETE /:id/invites/:inviteId`、`PUT /:id/members/:userId` `{ role }`
 * - `DELETE /:id/members/:userId`: owner は誰でも、参加者は自分だけ外せる
 * 招待とロールの変更は owner だけができ、他は 403。
 */
export function createMemberRoutes(now: () => number) {
  const app = new Hono<UserEnv>()

  app.get('/:id/members', async (c) => {
    const id = c.req.param('id')
    const role = await projectRole(c.env.DB, c.get('userId'), id)
    if (role === null) throw new ApiException('not_found')
    const { results } = await c.env.DB.prepare(
      `SELECT p.owner_id AS userId, 'owner' AS role, u.email AS email, u.name AS name, 0 AS rank, 0 AS created_at
       FROM projects p LEFT JOIN auth_users u ON u.id = p.owner_id WHERE p.id = ?1
       UNION ALL
       SELECT m.user_id, m.role, u.email, u.name, 1, m.created_at
       FROM project_members m LEFT JOIN auth_users u ON u.id = m.user_id WHERE m.project_id = ?1
       ORDER BY rank, created_at`,
    )
      .bind(id)
      .all<MemberRow>()
    const members = results.map(({ userId, role, email, name }) => ({ userId, role, email, name }))
    if (role !== 'owner') return c.json({ role, members, invites: [] })
    const invites = await c.env.DB.prepare(
      `SELECT id, email, role, expires_at AS expiresAt FROM project_invites
       WHERE project_id = ?1 AND expires_at > ?2 ORDER BY created_at`,
    )
      .bind(id, now())
      .all<{ id: string; email: string; role: string; expiresAt: number }>()
    return c.json({
      role,
      members,
      invites: invites.results.map((i) => ({
        ...i,
        expiresAt: new Date(i.expiresAt).toISOString(),
      })),
    })
  })

  /** 参加していなければ not_found、owner でなければ owner_only を throw する */
  const requireOwner = async (c: Context<UserEnv>, projectId: string) => {
    const role = await projectRole(c.env.DB, c.get('userId'), projectId)
    if (role === null) throw new ApiException('not_found')
    if (role !== 'owner') throw new ApiException('owner_only')
  }

  app.post('/:id/invites', async (c) => {
    await requireOwner(c, c.req.param('id'))
    const data = parseOrThrow(InviteSchema, await readJson(c.req.raw, 1024))

    const projectId = c.req.param('id')
    const email = normalizeEmail(data.email)
    const token = newToken()
    const invite = {
      id: crypto.randomUUID(),
      email,
      role: data.role,
      expiresAt: now() + INVITE_TTL_MS,
    }
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM project_invites WHERE project_id = ?1 AND email = ?2').bind(
        projectId,
        email,
      ),
      c.env.DB.prepare(
        `INSERT INTO project_invites (id, project_id, email, role, token_hash, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(
        invite.id,
        projectId,
        email,
        invite.role,
        await hashToken(token),
        now(),
        invite.expiresAt,
      ),
    ])
    return c.json({ ...invite, expiresAt: new Date(invite.expiresAt).toISOString(), token }, 201)
  })

  app.delete('/:id/invites/:inviteId', async (c) => {
    await requireOwner(c, c.req.param('id'))
    const { meta } = await c.env.DB.prepare(
      'DELETE FROM project_invites WHERE id = ?1 AND project_id = ?2',
    )
      .bind(c.req.param('inviteId'), c.req.param('id'))
      .run()
    if (meta.changes !== 1) throw new ApiException('not_found')
    return c.body(null, 204)
  })

  app.put('/:id/members/:userId', async (c) => {
    await requireOwner(c, c.req.param('id'))
    const { role } = parseOrThrow(RoleSchema, await readJson(c.req.raw, 1024))
    const projectId = c.req.param('id')
    const userId = c.req.param('userId')
    const { meta } = await c.env.DB.prepare(
      'UPDATE project_members SET role = ?3 WHERE project_id = ?1 AND user_id = ?2',
    )
      .bind(projectId, userId, role)
      .run()
    if (meta.changes !== 1) throw new ApiException('not_found')
    await revokeSync(c.env, projectId, userId)
    return c.body(null, 204)
  })

  app.delete('/:id/members/:userId', async (c) => {
    const projectId = c.req.param('id')
    const userId = c.req.param('userId')
    if (userId !== c.get('userId')) {
      await requireOwner(c, c.req.param('id'))
    } else if ((await projectRole(c.env.DB, userId, projectId)) === null) {
      throw new ApiException('not_found')
    }
    if (!(await removeMember(c.env, projectId, userId))) throw new ApiException('not_found')
    return c.body(null, 204)
  })

  return app
}

/**
 * `/v1/invites/:token`。招待リンクの受け口。
 * - `GET`: 招待先のメールアドレス、ロール、プロジェクトの id とタイトル。無いか期限切れなら 404
 * - `POST /accept`: ログイン中のユーザーのメールアドレスが招待先と同じなら参加させ、招待を消す。違えば 403。
 *   既に参加していればロールを招待のものにする。owner なら何も変えない
 */
export function createInviteApp(now: () => number) {
  const app = new Hono<UserEnv>()
  app.use('*', requireUser(now))

  const findInvite = async (env: Env, token: string) =>
    env.DB.prepare(
      `SELECT i.id AS id, i.email AS email, i.role AS role, i.project_id AS projectId,
              p.title AS projectTitle, i.expires_at AS expiresAt
       FROM project_invites i JOIN projects p ON p.id = i.project_id
       WHERE i.token_hash = ?1 AND i.expires_at > ?2`,
    )
      .bind(await hashToken(token), now())
      .first<{
        id: string
        email: string
        role: string
        projectId: string
        projectTitle: string
        expiresAt: number
      }>()

  app.get('/:token', async (c) => {
    const invite = await findInvite(c.env, c.req.param('token'))
    if (!invite) throw new ApiException('not_found')
    const { id: _, ...rest } = invite
    return c.json({ ...rest, expiresAt: new Date(invite.expiresAt).toISOString() })
  })

  app.post('/:token/accept', async (c) => {
    const invite = await findInvite(c.env, c.req.param('token'))
    if (!invite) throw new ApiException('not_found')
    const userId = c.get('userId')
    const email = await userEmail(c.env, userId)
    if (email === null || normalizeEmail(email) !== invite.email) {
      throw new ApiException('invite_email_mismatch')
    }
    const current = await projectRole(c.env.DB, userId, invite.projectId)
    await c.env.DB.batch([
      ...(current === 'owner'
        ? []
        : [
            c.env.DB.prepare(
              `INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`,
            ).bind(invite.projectId, userId, invite.role, now()),
          ]),
      c.env.DB.prepare('DELETE FROM project_invites WHERE id = ?1').bind(invite.id),
    ])
    if (current !== null && current !== 'owner') await revokeSync(c.env, invite.projectId, userId)
    return c.json({
      projectId: invite.projectId,
      role: current === 'owner' ? 'owner' : invite.role,
    })
  })

  return app
}
