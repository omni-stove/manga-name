import { env } from 'cloudflare:workers'
import { fixtures } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { INVITE_EMAIL_MISMATCH, INVITE_REQUIRED, validateSignUp } from '../src/auth'
import { hashToken } from '../src/token'
import { DEBUG_USER_HEADER } from '../src/user'

const app = createApp()
const staging = { ...env, ENVIRONMENT: 'staging' }

const DAY = 86_400_000

/** auth_users と auth_sessions に userId のユーザーと、token のセッションを expiresAt まで入れる */
async function seedSession(userId: string, token: string, expiresAt: number) {
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_users (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES (?1, ?1, ?1 || '@example.com', 1, NULL, ?2, ?2)`,
    ).bind(userId, now),
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, expiresAt, token, createdAt, updatedAt, userId)
       VALUES (?1, ?2, ?3, ?4, ?4, ?5)`,
    ).bind(`s_${token}`, new Date(expiresAt).toISOString(), token, now, userId),
  ])
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

function planPages(headers: Record<string, string>, target = env) {
  const { settings, characters } = fixtures.samplePage01
  return app.request(
    '/v1/ai/plan-pages',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ project: { settings, characters }, script: '森を歩く。' }),
    },
    target,
  )
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions'),
    env.DB.prepare('DELETE FROM auth_users'),
    env.DB.prepare('DELETE FROM ai_usage'),
    env.DB.prepare('DELETE FROM rate_limits'),
    env.DB.prepare('DELETE FROM project_invites'),
  ])
})

describe('Bearer token', () => {
  test('a valid session token authenticates as its user', async () => {
    await seedSession('u_alice', 'tok-alice', Date.now() + DAY)
    const res = await app.request('/v1/projects', { headers: bearer('tok-alice') }, staging)
    expect(res.status).toBe(200)
  })

  test('401 on a missing, unknown, malformed or expired token', async () => {
    await seedSession('u_alice', 'tok-alice', Date.now() + DAY)
    await seedSession('u_bob', 'tok-bob', Date.now() - 1_000)
    for (const headers of [
      {},
      bearer('nope'),
      { authorization: 'tok-alice' },
      { authorization: 'Basic tok-alice' },
      bearer('tok-bob'),
    ]) {
      expect((await app.request('/v1/projects', { headers }, staging)).status).toBe(401)
    }
  })

  test('/v1/ai/* is authenticated and counted for the session user', async () => {
    await seedSession('u_alice', 'tok-alice', Date.now() + DAY)
    expect((await planPages({}, staging)).status).toBe(401)
    expect((await planPages(bearer('nope'), staging)).status).toBe(401)

    expect((await planPages(bearer('tok-alice'), staging)).status).toBe(200)
    const { results } = await env.DB.prepare('SELECT user_id FROM ai_usage').all()
    expect(results).toEqual([{ user_id: 'u_alice' }])
  })
})

describe('X-Debug-User', () => {
  test('is accepted when ENVIRONMENT is development', async () => {
    expect(env.ENVIRONMENT).toBe('development')
    const headers = { [DEBUG_USER_HEADER]: 'alice' }
    expect((await app.request('/v1/projects', { headers }, env)).status).toBe(200)
    expect((await planPages(headers)).status).toBe(200)
  })

  test('accepts up to 128 letters, digits and ._@+- and rejects anything else', async () => {
    const status = async (user: string) =>
      (await app.request('/v1/projects', { headers: { [DEBUG_USER_HEADER]: user } }, env)).status
    expect(await status('a'.repeat(128))).toBe(200)
    expect(await status('A_z.0+9-@example.com')).toBe(200)
    expect(await status('a'.repeat(129))).toBe(401)
    expect(await status('')).toBe(401)
    expect(await status('a/b')).toBe(401)
  })

  test('takes precedence over the Bearer token in development, also when malformed', async () => {
    await seedSession('u_alice', 'tok-alice', Date.now() + DAY)
    expect((await app.request('/v1/projects', { headers: bearer('tok-alice') }, env)).status).toBe(
      200,
    )
    const headers = { ...bearer('tok-alice'), [DEBUG_USER_HEADER]: 'a b' }
    expect((await app.request('/v1/projects', { headers }, env)).status).toBe(401)

    const asBob = { ...bearer('tok-alice'), [DEBUG_USER_HEADER]: 'bob' }
    expect((await planPages(asBob)).status).toBe(200)
    const { results } = await env.DB.prepare('SELECT user_id FROM ai_usage').all()
    expect(results).toEqual([{ user_id: 'bob' }])
  })

  test('is ignored outside development', async () => {
    const headers = { [DEBUG_USER_HEADER]: 'alice' }
    expect((await app.request('/v1/projects', { headers }, staging)).status).toBe(401)
    expect((await planPages(headers, staging)).status).toBe(401)
  })

  test('does not override the Bearer user outside development', async () => {
    await seedSession('u_alice', 'tok-alice', Date.now() + DAY)
    const headers = { ...bearer('tok-alice'), [DEBUG_USER_HEADER]: 'mallory' }
    const res = await planPages(headers, staging)
    expect(res.status).toBe(200)
    const { results } = await env.DB.prepare('SELECT user_id FROM ai_usage').all()
    expect(results).toEqual([{ user_id: 'u_alice' }])
  })
})

describe('sign-up', () => {
  /** alice のプロジェクトに email 宛て（null なら誰でも受け取れる）の招待を expiresAt まで入れ、リンクのトークンを返す */
  async function seedInvite(email: string | null, expiresAt: number) {
    const headers = { [DEBUG_USER_HEADER]: 'alice', 'content-type': 'application/json' }
    const res = await app.request(
      '/v1/projects',
      { method: 'POST', headers, body: JSON.stringify({ title: '招待' }) },
      env,
    )
    const { id } = (await res.json()) as { id: string }
    const token = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO project_invites (id, project_id, email, role, token_hash, created_at, expires_at)
       VALUES (?1, ?2, ?3, 'viewer', ?4, 0, ?5)`,
    )
      .bind(crypto.randomUUID(), id, email, await hashToken(token), expiresAt)
      .run()
    return token
  }

  const validate = (email: string, token: unknown, action = 'create-user') =>
    validateSignUp(env, async () => token)({ user: { email }, source: { action } })

  test('lets the invited email sign up through the link, whatever its case', async () => {
    const token = await seedInvite('carol@example.com', Date.now() + DAY)
    expect(await validate('Carol@Example.com', token)).toBeUndefined()
  })

  test('refuses a sign-up without a link in time', async () => {
    const expired = await seedInvite('dave@example.com', Date.now() - 1_000)
    for (const token of [undefined, 42, 'unknown', expired]) {
      expect(await validate('dave@example.com', token)).toEqual({ error: INVITE_REQUIRED })
    }
  })

  test('refuses another email than the invited one, even with the link', async () => {
    const token = await seedInvite('carol@example.com', Date.now() + DAY)
    expect(await validate('eve@example.com', token)).toEqual({ error: INVITE_EMAIL_MISMATCH })
  })

  test('lets any email sign up through a link without an email', async () => {
    const token = await seedInvite(null, Date.now() + DAY)
    expect(await validate('eve@example.com', token)).toBeUndefined()
  })

  test('lets an existing user sign in without a link', async () => {
    expect(await validate('eve@example.com', undefined, 'sign-in')).toBeUndefined()
    expect(await validate('eve@example.com', undefined, 'link-account')).toBeUndefined()
  })
})
