import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'

const app = createApp()

const DAY = 86_400_000

/** auth_users と auth_sessions に u_alice と、token のセッションを入れる */
async function seedAlice(token: string) {
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO auth_users (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES ('u_alice', 'Alice', 'alice@example.com', 1, NULL, ?1, ?1)`,
    ).bind(now),
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, expiresAt, token, createdAt, updatedAt, userId)
       VALUES ('s_alice', ?1, ?2, ?3, ?3, 'u_alice')`,
    ).bind(new Date(Date.now() + DAY).toISOString(), token, now),
  ])
}

const location = (res: Response) => new URL(res.headers.get('location') ?? '')

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions'),
    env.DB.prepare('DELETE FROM auth_users'),
    env.DB.prepare('DELETE FROM auth_verifications'),
  ])
})

describe('GET /v1/desktop-sign-in', () => {
  test('redirects to Google with the state cookie, coming back to /done', async () => {
    const google = { ...env, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }
    const res = await app.request('http://api.test/v1/desktop-sign-in?invite=inv', {}, google)
    expect(res.status).toBe(302)
    const to = location(res)
    expect(to.hostname).toBe('accounts.google.com')
    expect(to.searchParams.get('redirect_uri')).toBe('http://api.test/v1/auth/callback/google')
    expect(res.headers.getSetCookie().join('\n')).toContain('state')
  })

  test('rejects a port outside 1024-65535', async () => {
    const google = { ...env, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }
    for (const port of ['80', '65536', 'x']) {
      const res = await app.request(`http://api.test/v1/desktop-sign-in?port=${port}`, {}, google)
      expect(res.status).toBe(400)
    }
  })
})

describe('GET /v1/desktop-sign-in/done', () => {
  test('hands the session to the app as a one-time token', async () => {
    await seedAlice('tok-alice')
    const res = await app.request(
      '/v1/desktop-sign-in/done',
      { headers: { authorization: 'Bearer tok-alice' } },
      env,
    )
    expect(res.status).toBe(302)
    const back = location(res)
    expect(`${back.protocol}//${back.host}`).toBe('manganame://auth')
    const token = back.searchParams.get('token') ?? ''
    expect(token).not.toBe('')

    const verified = await app.request(
      '/v1/auth/one-time-token/verify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      },
      env,
    )
    expect(verified.status).toBe(200)
    const body = (await verified.json()) as { session: { token: string }; user: { id: string } }
    expect(body.session.token).toBe('tok-alice')
    expect(body.user.id).toBe('u_alice')
    expect(verified.headers.getSetCookie()).toEqual([])
  })

  test('hands the token to the CLI on 127.0.0.1 when a port is given', async () => {
    await seedAlice('tok-alice')
    const res = await app.request(
      '/v1/desktop-sign-in/done?port=48123',
      { headers: { authorization: 'Bearer tok-alice' } },
      env,
    )
    const back = location(res)
    expect(back.origin).toBe('http://127.0.0.1:48123')
    expect(back.searchParams.get('token')).not.toBe('')
    const failed = await app.request('/v1/desktop-sign-in/done?port=48123&error=x', {}, env)
    expect(location(failed).origin).toBe('http://127.0.0.1:48123')
  })

  test('returns the sign-in error to the app', async () => {
    const res = await app.request('/v1/desktop-sign-in/done?error=invite_required', {}, env)
    expect(location(res).searchParams.get('error')).toBe('invite_required')
  })

  test('returns no_session when Google did not leave a session', async () => {
    const res = await app.request('/v1/desktop-sign-in/done', {}, env)
    expect(location(res).searchParams.get('error')).toBe('no_session')
  })
})
