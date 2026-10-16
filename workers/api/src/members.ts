import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { MEMBER_ROLES, type ProjectRole, projectRole, userEmail } from './access'
import { readJson } from './body'
import type { Env } from './env'
import { requireUser, type UserEnv } from './user'

/** 招待リンクの有効期間 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000

const InviteSchema = z.object({
  email: z.email().max(320),
  role: z.enum(MEMBER_ROLES),
})

const RoleSchema = z.object({ role: z.enum(MEMBER_ROLES) })

const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** 招待リンクに載せるトークン。256 ビットの乱数を base64url にしたもの */
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

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
    if (role === null) return c.json({ error: 'not found' }, 404)
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

  /** owner でなければその応答、owner なら null */
  const denyUnlessOwner = async (c: Context<UserEnv>, projectId: string) => {
    const role = await projectRole(c.env.DB, c.get('userId'), projectId)
    if (role === null) return c.json({ error: 'not found' }, 404)
    if (role !== 'owner') return c.json({ error: 'only the owner can manage members' }, 403)
    return null
  }

  app.post('/:id/invites', async (c) => {
    const denied = await denyUnlessOwner(c, c.req.param('id'))
    if (denied) return denied
    const body = await readJson(c.req.raw, 1024, 'request body is too large')
    if (!body.ok) return c.json({ error: body.error }, body.status)
    const parsed = InviteSchema.safeParse(body.value)
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)

    const projectId = c.req.param('id')
    const email = normalizeEmail(parsed.data.email)
    const token = newToken()
    const invite = {
      id: crypto.randomUUID(),
      email,
      role: parsed.data.role,
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
    const denied = await denyUnlessOwner(c, c.req.param('id'))
    if (denied) return denied
    const { meta } = await c.env.DB.prepare(
      'DELETE FROM project_invites WHERE id = ?1 AND project_id = ?2',
    )
      .bind(c.req.param('inviteId'), c.req.param('id'))
      .run()
    if (meta.changes !== 1) return c.json({ error: 'not found' }, 404)
    return c.body(null, 204)
  })

  app.put('/:id/members/:userId', async (c) => {
    const denied = await denyUnlessOwner(c, c.req.param('id'))
    if (denied) return denied
    const body = await readJson(c.req.raw, 1024, 'request body is too large')
    if (!body.ok) return c.json({ error: body.error }, body.status)
    const parsed = RoleSchema.safeParse(body.value)
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
    const projectId = c.req.param('id')
    const userId = c.req.param('userId')
    const { meta } = await c.env.DB.prepare(
      'UPDATE project_members SET role = ?3 WHERE project_id = ?1 AND user_id = ?2',
    )
      .bind(projectId, userId, parsed.data.role)
      .run()
    if (meta.changes !== 1) return c.json({ error: 'not found' }, 404)
    await revokeSync(c.env, projectId, userId)
    return c.body(null, 204)
  })

  app.delete('/:id/members/:userId', async (c) => {
    const projectId = c.req.param('id')
    const userId = c.req.param('userId')
    if (userId !== c.get('userId')) {
      const denied = await denyUnlessOwner(c, c.req.param('id'))
      if (denied) return denied
    } else if ((await projectRole(c.env.DB, userId, projectId)) === null) {
      return c.json({ error: 'not found' }, 404)
    }
    if (!(await removeMember(c.env, projectId, userId))) return c.json({ error: 'not found' }, 404)
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
    if (!invite) return c.json({ error: 'not found' }, 404)
    const { id: _, ...rest } = invite
    return c.json({ ...rest, expiresAt: new Date(invite.expiresAt).toISOString() })
  })

  app.post('/:token/accept', async (c) => {
    const invite = await findInvite(c.env, c.req.param('token'))
    if (!invite) return c.json({ error: 'not found' }, 404)
    const userId = c.get('userId')
    const email = await userEmail(c.env, userId)
    if (email === null || normalizeEmail(email) !== invite.email) {
      return c.json({ error: 'this invite is for another email address' }, 403)
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
    return c.json({ projectId: invite.projectId, role: current === 'owner' ? 'owner' : invite.role })
  })

  return app
}
