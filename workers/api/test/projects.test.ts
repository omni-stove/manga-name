import { env } from 'cloudflare:workers'
import { fixtures, type Project } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { splitDoc } from '../src/project-store'
import { MAX_PROJECT_BYTES } from '../src/projects'
import { DEBUG_USER_HEADER } from '../src/user'

const app = createApp()

interface CallInit {
  method?: string
  user?: string | null
  body?: string
  headers?: Record<string, string>
}

function call(path: string, init: CallInit = {}) {
  const { method = 'GET', user = 'alice', body, headers = {} } = init
  return app.request(
    path,
    {
      method,
      headers: {
        ...(user === null ? {} : { [DEBUG_USER_HEADER]: user }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body,
    },
    env,
  )
}

async function create(title = 'ネーム', user = 'alice') {
  const res = await call('/v1/projects', { method: 'POST', user, body: JSON.stringify({ title }) })
  expect(res.status).toBe(201)
  return { project: (await res.json()) as Project, etag: res.headers.get('etag') ?? '' }
}

function put(project: Project, etag: string | null, user = 'alice') {
  return call(`/v1/projects/${project.id}`, {
    method: 'PUT',
    user,
    body: JSON.stringify(project),
    headers: etag === null ? {} : { 'if-match': etag },
  })
}

const chunkCount = async () =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM project_doc_chunks').first<{ n: number }>())?.n

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits'),
    env.DB.prepare('DELETE FROM assets'),
    env.DB.prepare('DELETE FROM project_doc_chunks'),
    env.DB.prepare('DELETE FROM projects'),
    env.DB.prepare('DELETE FROM users'),
  ])
})

describe('authentication', () => {
  test('401 without X-Debug-User or with a malformed one', async () => {
    expect((await call('/v1/projects', { user: null })).status).toBe(401)
    expect((await call('/v1/projects', { user: 'a b' })).status).toBe(401)
    expect((await call('/v1/projects/x', { user: null })).status).toBe(401)
  })
})

describe('POST /v1/projects', () => {
  test('creates an empty project owned by the user', async () => {
    const { project, etag } = await create('第1話')
    expect(project).toMatchObject({ title: '第1話', episodes: [], characters: [] })
    expect(etag).toBe(`"${project.updatedAt}"`)
    const user = await env.DB.prepare('SELECT id FROM users').first<{ id: string }>()
    expect(user?.id).toBe('alice')
  })

  test('400 on a missing or blank title, and on invalid JSON', async () => {
    const post = (body: string) => call('/v1/projects', { method: 'POST', body })
    expect((await post('{}')).status).toBe(400)
    expect((await post(JSON.stringify({ title: '  ' }))).status).toBe(400)
    expect((await post('{')).status).toBe(400)
  })
})

describe('GET /v1/projects', () => {
  test('lists only the caller’s projects with their current title and updatedAt', async () => {
    const first = await create('one')
    const second = await create('two')
    await create('bob', 'bob')
    const saved = await put({ ...first.project, title: 'one edited' }, first.etag)
    const { updatedAt } = (await saved.json()) as { updatedAt: string }

    const res = await call('/v1/projects')
    expect(res.status).toBe(200)
    const { projects } = (await res.json()) as {
      projects: { id: string; title: string; updatedAt: string }[]
    }
    expect(projects).toHaveLength(2)
    expect(projects).toContainEqual({ id: first.project.id, title: 'one edited', updatedAt })
    expect(projects).toContainEqual({
      id: second.project.id,
      title: 'two',
      updatedAt: second.project.updatedAt,
    })
  })
})

describe('GET /v1/projects/:id', () => {
  test('returns the stored project with its ETag', async () => {
    const { project, etag } = await create()
    const res = await call(`/v1/projects/${project.id}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe(etag)
    expect(await res.json()).toEqual(project)
  })

  test('404 for an unknown id and for another user’s project', async () => {
    const { project } = await create()
    expect((await call('/v1/projects/missing')).status).toBe(404)
    expect((await call(`/v1/projects/${project.id}`, { user: 'bob' })).status).toBe(404)
  })
})

describe('PUT /v1/projects/:id', () => {
  test('smoke: PUT the sample fixture and GET it back', async () => {
    const { project, etag } = await create()
    const doc = { ...fixtures.samplePage01, id: project.id }

    const res = await put(doc, etag)
    expect(res.status).toBe(200)
    const { updatedAt } = (await res.json()) as { updatedAt: string }
    expect(res.headers.get('etag')).toBe(`"${updatedAt}"`)
    expect(updatedAt > project.updatedAt).toBe(true)

    const got = await call(`/v1/projects/${project.id}`)
    expect(got.headers.get('etag')).toBe(`"${updatedAt}"`)
    expect(await got.json()).toEqual({ ...doc, updatedAt })
    expect(await chunkCount()).toBe(1)
  })

  test('409 when If-Match is stale, keeping the newer version', async () => {
    const { project, etag } = await create()
    const saved = await put({ ...project, title: 'first' }, etag)
    expect(saved.status).toBe(200)

    const stale = await put({ ...project, title: 'second' }, etag)
    expect(stale.status).toBe(409)
    expect(stale.headers.get('etag')).toBe(saved.headers.get('etag'))

    const got = await call(`/v1/projects/${project.id}`)
    expect(((await got.json()) as Project).title).toBe('first')
  })

  test('concurrent saves from the same version: exactly one wins', async () => {
    const { project, etag } = await create()
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) => put({ ...project, title: `t${i}` }, etag)),
    )
    const statuses = responses.map((r) => r.status)
    expect(statuses.filter((s) => s === 200)).toHaveLength(1)
    expect(statuses.filter((s) => s === 409)).toHaveLength(4)

    const winner = responses.findIndex((r) => r.status === 200)
    const got = await call(`/v1/projects/${project.id}`)
    expect(((await got.json()) as Project).title).toBe(`t${winner}`)
    expect(await chunkCount()).toBe(1)
  })

  test('428 without If-Match, 400 with a malformed one', async () => {
    const { project } = await create()
    expect((await put(project, null)).status).toBe(428)
    expect((await put(project, project.updatedAt)).status).toBe(400)
  })

  test('400 when the body does not pass parseProject or the id differs', async () => {
    const { project, etag } = await create()
    const path = `/v1/projects/${project.id}`
    const headers = { 'if-match': etag }
    expect((await call(path, { method: 'PUT', body: '{', headers })).status).toBe(400)
    expect(
      (await call(path, { method: 'PUT', body: JSON.stringify({ schemaVersion: 1 }), headers }))
        .status,
    ).toBe(400)
    expect(
      (
        await call(path, {
          method: 'PUT',
          body: JSON.stringify({ ...project, id: 'other' }),
          headers,
        })
      ).status,
    ).toBe(400)
  })

  test('404 for another user’s project', async () => {
    const { project, etag } = await create()
    expect((await put(project, etag, 'bob')).status).toBe(404)
  })

  test('413 over 5MB', async () => {
    const { project, etag } = await create()
    const res = await put({ ...project, title: 'x'.repeat(MAX_PROJECT_BYTES) }, etag)
    expect(res.status).toBe(413)
  })

  test('round-trips a multi-megabyte project split across rows', async () => {
    const { project, etag } = await create()
    const big = { ...project, title: '😀'.repeat(1_000_000) }
    const res = await put(big, etag)
    expect(res.status).toBe(200)
    const { updatedAt } = (await res.json()) as { updatedAt: string }

    const got = await call(`/v1/projects/${project.id}`)
    expect(await got.json()).toEqual({ ...big, updatedAt })
    expect(await chunkCount()).toBeGreaterThan(1)

    const { projects } = (await (await call('/v1/projects')).json()) as {
      projects: { title: string }[]
    }
    expect([...(projects[0]?.title ?? '')]).toHaveLength(200)
  })
})

describe('DELETE /v1/projects/:id', () => {
  test('removes the project and its body', async () => {
    const { project } = await create()
    const path = `/v1/projects/${project.id}`
    expect((await call(path, { method: 'DELETE', user: 'bob' })).status).toBe(404)
    const res = await call(path, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect((await call(path)).status).toBe(404)
    expect(await chunkCount()).toBe(0)
    expect((await call(path, { method: 'DELETE' })).status).toBe(404)
  })
})

describe('splitDoc', () => {
  test('never splits a surrogate pair and joins back to the input', () => {
    const emoji = '😀'.repeat(600_000)
    for (const text of ['a'.repeat(1_200_000), `a${emoji}`, emoji]) {
      const chunks = splitDoc(text)
      expect(chunks.join('')).toBe(text)
      for (const chunk of chunks) {
        const last = chunk.charCodeAt(chunk.length - 1)
        expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
        expect(chunk.length).toBeLessThanOrEqual(500_000)
      }
    }
  })
})
