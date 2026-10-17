import { env } from 'cloudflare:workers'
import type { Project } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { DEBUG_USER_HEADER } from '../src/user'

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0)

const app = createApp({ now: () => NOW })

function call(path: string, init: { method?: string; user?: string | null; body?: unknown } = {}) {
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

const putName = (body: unknown, user: string | null = 'alice') =>
  call('/v1/me', { method: 'PUT', user, body })

/** X-Debug-User の userId と同じ id で、Google から登録した直後の（name が空の）auth_users の行を入れる */
async function seedUser(userId: string) {
  await env.DB.prepare(
    `INSERT INTO auth_users (id, name, email, emailVerified, image, createdAt, updatedAt)
     VALUES (?1, '', ?1 || '@example.com', 1, NULL, ?2, ?2)`,
  )
    .bind(userId, new Date(0).toISOString())
    .run()
}

const storedName = async (userId: string) =>
  (
    await env.DB.prepare('SELECT name FROM auth_users WHERE id = ?1')
      .bind(userId)
      .first<{ name: string }>()
  )?.name

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits'),
    env.DB.prepare('DELETE FROM project_members'),
    env.DB.prepare('DELETE FROM project_doc_chunks'),
    env.DB.prepare('DELETE FROM projects'),
    env.DB.prepare('DELETE FROM users'),
    env.DB.prepare('DELETE FROM auth_users'),
  ])
})

describe('PUT /v1/me', () => {
  test('sets the trimmed display name and returns it', async () => {
    await seedUser('alice')
    const res = await putName({ name: '  ペンネーム ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'ペンネーム' })
    expect(await storedName('alice')).toBe('ペンネーム')
  })

  test('400 on an empty, blank, too long or missing name, leaving the name as it was', async () => {
    await seedUser('alice')
    for (const body of [{ name: '' }, { name: '   ' }, { name: 'あ'.repeat(41) }, {}, 'nope']) {
      expect((await putName(body)).status).toBe(400)
    }
    expect(await storedName('alice')).toBe('')
  })

  test('401 without a user, 404 for a user with no auth_users row', async () => {
    expect((await putName({ name: 'A' }, null)).status).toBe(401)
    expect((await putName({ name: 'A' }, 'bob')).status).toBe(404)
  })

  test('changes only the caller', async () => {
    await seedUser('alice')
    await seedUser('bob')
    await putName({ name: 'A' })
    expect(await storedName('bob')).toBe('')
  })
})

test('Better Auth update-user is closed so the name only goes through PUT /v1/me', async () => {
  const res = await call('/v1/auth/update-user', { method: 'POST', body: { name: 'x' } })
  expect(res.status).toBe(404)
})

test('members show a null name until the display name is set', async () => {
  await seedUser('alice')
  const created = await call('/v1/projects', { method: 'POST', body: { title: '共有' } })
  const project = (await created.json()) as Project
  const name = async () => {
    const res = await call(`/v1/projects/${project.id}/members`)
    const body = (await res.json()) as { members: { name: string | null }[] }
    return body.members[0]?.name
  }
  expect(await name()).toBeNull()
  await putName({ name: 'ペンネーム' })
  expect(await name()).toBe('ペンネーム')
})
