import { env } from 'cloudflare:workers'
import type { Project } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { DEBUG_USER_HEADER } from '../src/user'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0)
let clock = NOW

const app = createApp({ now: () => clock })

interface CallInit {
  method?: string
  user?: string | null
  body?: unknown
}

function call(path: string, init: CallInit = {}) {
  const { method = 'GET', user = 'alice', body } = init
  return app.request(
    path,
    {
      method,
      headers: {
        ...(user === null ? {} : { [DEBUG_USER_HEADER]: user }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    },
    env,
  )
}

async function createProject(user = 'alice', title = '共有') {
  const res = await call('/v1/projects', { method: 'POST', user, body: { title } })
  expect(res.status).toBe(201)
  return (await res.json()) as Project
}

interface Invite {
  id: string
  email: string | null
  role: string
  expiresAt: string
  token: string
}

/** email が null なら、誰でも受け取れる招待を作る */
async function invite(projectId: string, email: string | null, role: string, user = 'alice') {
  const res = await call(`/v1/projects/${projectId}/invites`, {
    method: 'POST',
    user,
    body: email === null ? { role } : { email, role },
  })
  expect(res.status).toBe(201)
  return (await res.json()) as Invite
}

const accept = (token: string, user: string) =>
  call(`/v1/invites/${token}/accept`, { method: 'POST', user })

/** userId を role で project に参加させる。development では @ を含む X-Debug-User がそのメールアドレスになる */
async function join(projectId: string, userId: string, role: string) {
  // 時刻を止めたままだと created_at が並び、参加者一覧の順が決まらない
  clock += 1
  const { token } = await invite(projectId, userId, role)
  const res = await accept(token, userId)
  expect(res.status).toBe(200)
}

interface Members {
  role: string
  members: { userId: string; role: string; email: string | null; name: string | null }[]
  invites: { id: string; email: string | null; role: string; expiresAt: string }[]
}

async function members(projectId: string, user = 'alice') {
  const res = await call(`/v1/projects/${projectId}/members`, { user })
  expect(res.status).toBe(200)
  return (await res.json()) as Members
}

/** 同期の WebSocket を開き、閉じられたときのコードを返す */
async function openSync(projectId: string, user: string) {
  const res = await app.request(
    `/v1/projects/${projectId}/sync`,
    { headers: { upgrade: 'websocket', [DEBUG_USER_HEADER]: user } },
    env,
  )
  expect(res.status).toBe(101)
  const ws = res.webSocket
  if (!ws) throw new Error('no WebSocket in the response')
  ws.accept()
  const closed = new Promise<number>((resolve) =>
    ws.addEventListener('close', (event) => resolve(event.code)),
  )
  return { closed }
}

const EDITOR = 'ed@example.com'
const COMMENTER = 'co@example.com'
const VIEWER = 'vi@example.com'

/** alice が owner で、editor / commenter / viewer が 1 人ずつ参加しているプロジェクト */
async function sharedProject() {
  const project = await createProject()
  await join(project.id, EDITOR, 'editor')
  await join(project.id, COMMENTER, 'commenter')
  await join(project.id, VIEWER, 'viewer')
  return project
}

beforeEach(async () => {
  clock = NOW
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits'),
    env.DB.prepare('DELETE FROM sync_tickets'),
    env.DB.prepare('DELETE FROM project_invites'),
    env.DB.prepare('DELETE FROM project_members'),
    env.DB.prepare('DELETE FROM project_doc_chunks'),
    env.DB.prepare('DELETE FROM projects'),
    env.DB.prepare('DELETE FROM users'),
    env.DB.prepare('DELETE FROM auth_users'),
  ])
})

describe('GET /v1/projects/:id/members', () => {
  test('the owner sees the owner first, members in join order and pending invites', async () => {
    const project = await sharedProject()
    const pending = await invite(project.id, 'new@example.com', 'viewer')

    expect(await members(project.id)).toEqual({
      role: 'owner',
      members: [
        { userId: 'alice', role: 'owner', email: null, name: null },
        { userId: EDITOR, role: 'editor', email: null, name: null },
        { userId: COMMENTER, role: 'commenter', email: null, name: null },
        { userId: VIEWER, role: 'viewer', email: null, name: null },
      ],
      invites: [
        {
          id: pending.id,
          email: 'new@example.com',
          role: 'viewer',
          expiresAt: pending.expiresAt,
        },
      ],
    })
  })

  test('members see their own role and no invites', async () => {
    const project = await sharedProject()
    await invite(project.id, 'new@example.com', 'viewer')
    for (const [user, role] of [
      [EDITOR, 'editor'],
      [COMMENTER, 'commenter'],
      [VIEWER, 'viewer'],
    ]) {
      const got = await members(project.id, user)
      expect(got.role).toBe(role)
      expect(got.members).toHaveLength(4)
      expect(got.invites).toEqual([])
    }
  })

  test('includes the email and name of Better Auth users', async () => {
    await env.DB.prepare(
      `INSERT INTO auth_users (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES ('u_alice', 'Alice', 'alice@example.com', 1, NULL, ?1, ?1)`,
    )
      .bind(new Date(NOW).toISOString())
      .run()
    const project = await createProject('u_alice')
    expect((await members(project.id, 'u_alice')).members).toEqual([
      { userId: 'u_alice', role: 'owner', email: 'alice@example.com', name: 'Alice' },
    ])
  })

  test('leaves out expired invites', async () => {
    const project = await createProject()
    await invite(project.id, 'old@example.com', 'viewer')
    clock += 7 * DAY
    expect((await members(project.id)).invites).toEqual([])
  })

  test('404 for a non-member and a missing project, 401 without a user', async () => {
    const project = await createProject()
    expect((await call(`/v1/projects/${project.id}/members`, { user: 'bob' })).status).toBe(404)
    expect((await call('/v1/projects/missing/members')).status).toBe(404)
    expect((await call(`/v1/projects/${project.id}/members`, { user: null })).status).toBe(401)
  })
})

describe('POST /v1/projects/:id/invites', () => {
  test('returns the invite with a token, storing the email in lower case and only the token hash', async () => {
    const project = await createProject()
    const created = await invite(project.id, 'Carol@Example.COM', 'editor')
    expect(created).toMatchObject({
      email: 'carol@example.com',
      role: 'editor',
      expiresAt: new Date(NOW + 7 * DAY).toISOString(),
    })
    expect(created.token).toMatch(/^[\w-]{43}$/)
    const row = await env.DB.prepare('SELECT email, token_hash FROM project_invites').first<{
      email: string
      token_hash: string
    }>()
    expect(row?.email).toBe('carol@example.com')
    expect(row?.token_hash).not.toBe(created.token)
  })

  test('inviting the same email again replaces the old invite', async () => {
    const project = await createProject()
    const first = await invite(project.id, 'carol@example.com', 'viewer')
    const second = await invite(project.id, 'CAROL@example.com', 'editor')
    expect((await members(project.id)).invites.map((i) => i.id)).toEqual([second.id])
    expect((await call(`/v1/invites/${first.token}`)).status).toBe(404)
    expect((await call(`/v1/invites/${second.token}`)).status).toBe(200)
  })

  test('the same email can be invited to two projects independently', async () => {
    const one = await createProject()
    const two = await createProject()
    const a = await invite(one.id, 'carol@example.com', 'viewer')
    await invite(two.id, 'carol@example.com', 'editor')
    expect((await call(`/v1/invites/${a.token}`)).status).toBe(200)
  })

  test('400 on an invalid email, an owner or unknown role and invalid JSON, 413 on a large body', async () => {
    const project = await createProject()
    const path = `/v1/projects/${project.id}/invites`
    for (const body of [
      { email: 'not an email', role: 'viewer' },
      { email: 'carol@example.com', role: 'owner' },
      { email: 'carol@example.com', role: 'admin' },
      { email: 'carol@example.com' },
      '{',
    ]) {
      expect((await call(path, { method: 'POST', body })).status, JSON.stringify(body)).toBe(400)
    }
    const large = { email: 'carol@example.com', role: 'viewer', pad: 'x'.repeat(1024) }
    expect((await call(path, { method: 'POST', body: large })).status).toBe(413)
    expect((await members(project.id)).invites).toEqual([])
  })

  test('only the owner can invite: 403 for members, 404 for non-members, 401 without a user', async () => {
    const project = await sharedProject()
    const path = `/v1/projects/${project.id}/invites`
    const body = { email: 'mallory@example.com', role: 'editor' }
    for (const user of [EDITOR, COMMENTER, VIEWER]) {
      expect((await call(path, { method: 'POST', user, body })).status, user).toBe(403)
    }
    expect((await call(path, { method: 'POST', user: 'bob', body })).status).toBe(404)
    expect((await call(path, { method: 'POST', user: null, body })).status).toBe(401)
    expect((await call('/v1/projects/missing/invites', { method: 'POST', body })).status).toBe(404)
    expect((await members(project.id)).invites).toEqual([])
  })

  test('the owner of another project cannot invite to this one', async () => {
    const project = await createProject()
    await createProject('bob')
    const res = await call(`/v1/projects/${project.id}/invites`, {
      method: 'POST',
      user: 'bob',
      body: { email: 'bob@example.com', role: 'editor' },
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /v1/projects/:id/invites/:inviteId', () => {
  test('removes the invite so that its link stops working', async () => {
    const project = await createProject()
    const created = await invite(project.id, 'carol@example.com', 'viewer')
    const path = `/v1/projects/${project.id}/invites/${created.id}`
    expect((await call(path, { method: 'DELETE' })).status).toBe(204)
    expect((await members(project.id)).invites).toEqual([])
    expect((await call(`/v1/invites/${created.token}`)).status).toBe(404)
    expect((await call(path, { method: 'DELETE' })).status).toBe(404)
  })

  test('only the owner can remove invites', async () => {
    const project = await sharedProject()
    const created = await invite(project.id, 'carol@example.com', 'viewer')
    const path = `/v1/projects/${project.id}/invites/${created.id}`
    for (const user of [EDITOR, COMMENTER, VIEWER]) {
      expect((await call(path, { method: 'DELETE', user })).status, user).toBe(403)
    }
    expect((await call(path, { method: 'DELETE', user: 'bob' })).status).toBe(404)
    expect((await call(path, { method: 'DELETE', user: null })).status).toBe(401)
    expect((await members(project.id)).invites).toHaveLength(1)
  })

  test('404 for an invite of another project, which is kept', async () => {
    const mine = await createProject()
    const other = await createProject()
    const theirs = await createProject('bob')
    const otherInvite = await invite(other.id, 'carol@example.com', 'viewer')
    const bobInvite = await invite(theirs.id, 'dave@example.com', 'viewer', 'bob')
    for (const id of [otherInvite.id, bobInvite.id]) {
      expect(
        (await call(`/v1/projects/${mine.id}/invites/${id}`, { method: 'DELETE' })).status,
      ).toBe(404)
    }
    expect((await call(`/v1/invites/${otherInvite.token}`)).status).toBe(200)
    expect((await call(`/v1/invites/${bobInvite.token}`)).status).toBe(200)
  })
})

describe('PUT /v1/projects/:id/members/:userId', () => {
  const putRole = (
    projectId: string,
    userId: string,
    role: unknown,
    user: string | null = 'alice',
  ) =>
    call(`/v1/projects/${projectId}/members/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      user,
      body: { role },
    })

  test('the owner changes a member’s role', async () => {
    const project = await sharedProject()
    expect((await putRole(project.id, VIEWER, 'editor')).status).toBe(204)
    expect((await members(project.id, VIEWER)).role).toBe('editor')
  })

  test('closes the member’s sync connections so that they reconnect with the new role', async () => {
    const project = await sharedProject()
    const { closed } = await openSync(project.id, EDITOR)
    expect((await putRole(project.id, EDITOR, 'viewer')).status).toBe(204)
    expect(await closed).toBe(4401)
  })

  test('400 on the owner role or an unknown role', async () => {
    const project = await sharedProject()
    for (const role of ['owner', 'admin', undefined]) {
      expect((await putRole(project.id, VIEWER, role)).status).toBe(400)
    }
    expect((await members(project.id, VIEWER)).role).toBe('viewer')
  })

  test('only the owner can change roles, and nobody can change their own role', async () => {
    const project = await sharedProject()
    for (const user of [EDITOR, COMMENTER, VIEWER]) {
      expect((await putRole(project.id, VIEWER, 'editor', user)).status, user).toBe(403)
      expect((await putRole(project.id, user, 'editor', user)).status, `${user} self`).toBe(403)
    }
    expect((await putRole(project.id, VIEWER, 'editor', 'bob')).status).toBe(404)
    expect((await putRole(project.id, VIEWER, 'editor', null)).status).toBe(401)
    expect((await members(project.id, VIEWER)).role).toBe('viewer')
    expect((await members(project.id, COMMENTER)).role).toBe('commenter')
  })

  test('404 for the owner, a non-member and a member of another project', async () => {
    const project = await createProject()
    const other = await createProject()
    await join(other.id, EDITOR, 'viewer')
    expect((await putRole(project.id, 'alice', 'viewer')).status).toBe(404)
    expect((await putRole(project.id, 'nobody', 'viewer')).status).toBe(404)
    expect((await putRole(project.id, EDITOR, 'editor')).status).toBe(404)
    expect((await members(other.id, EDITOR)).role).toBe('viewer')
    expect((await members(project.id)).members.map((m) => m.userId)).toEqual(['alice'])
  })
})

describe('DELETE /v1/projects/:id/members/:userId', () => {
  const remove = (projectId: string, userId: string, user: string | null = 'alice') =>
    call(`/v1/projects/${projectId}/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      user,
    })

  test('the owner removes a member, who then loses access', async () => {
    const project = await sharedProject()
    expect((await remove(project.id, EDITOR)).status).toBe(204)
    expect((await call(`/v1/projects/${project.id}`, { user: EDITOR })).status).toBe(404)
    expect((await remove(project.id, EDITOR)).status).toBe(404)
  })

  test('closes the removed member’s sync connections', async () => {
    const project = await sharedProject()
    const { closed } = await openSync(project.id, COMMENTER)
    expect((await remove(project.id, COMMENTER)).status).toBe(204)
    expect(await closed).toBe(4401)
  })

  test('a member can leave by removing themselves', async () => {
    const project = await sharedProject()
    for (const user of [EDITOR, COMMENTER, VIEWER]) {
      expect((await remove(project.id, user, user)).status, user).toBe(204)
    }
    expect((await members(project.id)).members.map((m) => m.userId)).toEqual(['alice'])
  })

  test('members cannot remove others: 403 for members, 404 for non-members, 401 without a user', async () => {
    const project = await sharedProject()
    for (const user of [EDITOR, COMMENTER, VIEWER]) {
      for (const target of [EDITOR, COMMENTER, VIEWER, 'alice'].filter((t) => t !== user)) {
        expect((await remove(project.id, target, user)).status, `${user} -> ${target}`).toBe(403)
      }
    }
    expect((await remove(project.id, EDITOR, 'bob')).status).toBe(404)
    expect((await remove(project.id, EDITOR, null)).status).toBe(401)
    expect((await members(project.id)).members).toHaveLength(4)
  })

  test('404 when a non-member removes themselves or the owner removes themselves', async () => {
    const project = await createProject()
    expect((await remove(project.id, 'bob', 'bob')).status).toBe(404)
    expect((await remove(project.id, 'alice')).status).toBe(404)
    expect((await call(`/v1/projects/${project.id}`)).status).toBe(200)
  })

  test('404 for a member of another project, who stays there', async () => {
    const project = await createProject()
    const other = await createProject()
    const theirs = await createProject('bob')
    await join(other.id, EDITOR, 'editor')
    const { token } = await invite(theirs.id, COMMENTER, 'commenter', 'bob')
    expect((await accept(token, COMMENTER)).status).toBe(200)

    expect((await remove(project.id, EDITOR)).status).toBe(404)
    expect((await remove(project.id, COMMENTER)).status).toBe(404)
    expect((await members(other.id, EDITOR)).role).toBe('editor')
    expect((await members(theirs.id, COMMENTER)).role).toBe('commenter')
  })
})

describe('GET /v1/invites/:token', () => {
  test('returns the email, role and project of the invite to any signed-in user', async () => {
    const project = await createProject('alice', '招待先')
    const created = await invite(project.id, 'carol@example.com', 'commenter')
    const res = await call(`/v1/invites/${created.token}`, { user: 'someone' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      email: 'carol@example.com',
      role: 'commenter',
      projectId: project.id,
      projectTitle: '招待先',
      expiresAt: created.expiresAt,
    })
  })

  test('404 for an unknown token and after the invite expires, 401 without a user', async () => {
    const project = await createProject()
    const created = await invite(project.id, 'carol@example.com', 'viewer')
    expect((await call('/v1/invites/unknown')).status).toBe(404)
    expect((await call(`/v1/invites/${created.token}`, { user: null })).status).toBe(401)
    clock += 7 * DAY - 1
    expect((await call(`/v1/invites/${created.token}`)).status).toBe(200)
    clock += 1
    expect((await call(`/v1/invites/${created.token}`)).status).toBe(404)
  })

  test('404 once the project is deleted', async () => {
    const project = await createProject()
    const created = await invite(project.id, 'carol@example.com', 'viewer')
    expect((await call(`/v1/projects/${project.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await call(`/v1/invites/${created.token}`)).status).toBe(404)
  })
})

describe('POST /v1/invites/:token/accept', () => {
  test('joins the project with the invited role and uses up the invite', async () => {
    const project = await createProject()
    const created = await invite(project.id, 'carol@example.com', 'commenter')
    const res = await accept(created.token, 'carol@example.com')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ projectId: project.id, role: 'commenter' })
    expect((await members(project.id, 'carol@example.com')).role).toBe('commenter')

    expect((await accept(created.token, 'carol@example.com')).status).toBe(404)
    expect((await call(`/v1/invites/${created.token}`)).status).toBe(404)
    expect((await members(project.id)).invites).toEqual([])
  })

  test('matches the Better Auth email of the user regardless of case', async () => {
    await env.DB.prepare(
      `INSERT INTO auth_users (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES ('u_carol', 'Carol', 'Carol@Example.com', 1, NULL, ?1, ?1)`,
    )
      .bind(new Date(NOW).toISOString())
      .run()
    const project = await createProject()
    const created = await invite(project.id, 'CAROL@example.com', 'editor')
    expect((await accept(created.token, 'u_carol')).status).toBe(200)
    expect((await members(project.id)).members[1]).toEqual({
      userId: 'u_carol',
      role: 'editor',
      email: 'Carol@Example.com',
      name: 'Carol',
    })
  })

  test('403 for a user with another email or no email, keeping the invite', async () => {
    const project = await createProject()
    const created = await invite(project.id, 'carol@example.com', 'editor')
    for (const user of ['mallory@example.com', 'carol', 'alice']) {
      const res = await accept(created.token, user)
      expect(res.status, user).toBe(403)
    }
    expect((await call(`/v1/projects/${project.id}`, { user: 'mallory@example.com' })).status).toBe(
      404,
    )
    expect((await accept(created.token, 'carol@example.com')).status).toBe(200)
  })

  test('404 for an unknown or expired token, 401 without a user', async () => {
    const project = await createProject()
    const created = await invite(project.id, 'carol@example.com', 'editor')
    expect((await accept('unknown', 'carol@example.com')).status).toBe(404)
    expect(
      (await call(`/v1/invites/${created.token}/accept`, { method: 'POST', user: null })).status,
    ).toBe(401)
    clock += 7 * DAY
    expect((await accept(created.token, 'carol@example.com')).status).toBe(404)
    expect((await call(`/v1/projects/${project.id}`, { user: 'carol@example.com' })).status).toBe(
      404,
    )
  })

  test('an existing member takes the invited role and their sync connections are closed', async () => {
    const project = await sharedProject()
    const { closed } = await openSync(project.id, EDITOR)
    const { token } = await invite(project.id, EDITOR, 'viewer')
    const res = await accept(token, EDITOR)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ projectId: project.id, role: 'viewer' })
    expect(await closed).toBe(4401)
    expect((await members(project.id)).members.filter((m) => m.userId === EDITOR)).toEqual([
      { userId: EDITOR, role: 'viewer', email: null, name: null },
    ])
  })

  test('an invite without an email lets anyone join, until it expires or is revoked', async () => {
    const project = await createProject()
    const created = await invite(project.id, null, 'commenter')
    expect(created.email).toBeNull()
    const preview = await call(`/v1/invites/${created.token}`, { user: 'carol' })
    expect(((await preview.json()) as { email: unknown }).email).toBeNull()
    for (const user of ['carol', 'dave@example.com']) {
      clock += 1
      const res = await accept(created.token, user)
      expect(res.status, user).toBe(200)
      expect(await res.json()).toEqual({ projectId: project.id, role: 'commenter' })
    }
    expect((await members(project.id)).members.map((m) => [m.userId, m.role])).toEqual([
      ['alice', 'owner'],
      ['carol', 'commenter'],
      ['dave@example.com', 'commenter'],
    ])
    expect((await members(project.id)).invites.map((i) => i.id)).toEqual([created.id])

    await call(`/v1/projects/${project.id}/invites/${created.id}`, { method: 'DELETE' })
    expect((await accept(created.token, 'erin')).status).toBe(404)
  })

  test('an invite without an email keeps the role of those already in the project', async () => {
    const project = await sharedProject()
    const { token } = await invite(project.id, null, 'viewer')
    for (const [user, role] of [
      [EDITOR, 'editor'],
      ['alice', 'owner'],
    ] as const) {
      const res = await accept(token, user)
      expect(await res.json()).toEqual({ projectId: project.id, role })
    }
    expect((await members(project.id, EDITOR)).role).toBe('editor')
  })

  test('another invite without an email does not replace the first', async () => {
    const project = await createProject()
    const first = await invite(project.id, null, 'viewer')
    const second = await invite(project.id, null, 'editor')
    expect((await members(project.id)).invites.map((i) => i.id)).toEqual([first.id, second.id])
  })

  test('the owner accepting an invite to their own project stays the owner', async () => {
    const project = await createProject('owner@example.com')
    const { token } = await invite(project.id, 'owner@example.com', 'viewer', 'owner@example.com')
    const res = await accept(token, 'owner@example.com')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ projectId: project.id, role: 'owner' })
    const got = await members(project.id, 'owner@example.com')
    expect(got.role).toBe('owner')
    expect(got.members).toEqual([
      { userId: 'owner@example.com', role: 'owner', email: null, name: null },
    ])
    expect(got.invites).toEqual([])
  })
})
