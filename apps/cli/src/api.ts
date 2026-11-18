import type { PagePlanRequest, PagePlanResponse } from '@manga/ai'
import { PagePlanResponseSchema, type Project, parseProject, readApiError } from '@manga/schema'

/** workers/api の認証。debugUser は `ENVIRONMENT=development` の workers/api にだけ通る X-Debug-User */
export type ApiAuth = { token: string } | { debugUser: string }

export interface ApiClientOptions {
  /** workers/api のオリジン。末尾の `/` は無視する */
  baseUrl: string
  auth: ApiAuth
  fetch?: typeof fetch
}

/** `GET /v1/projects` の 1 件。自分が owner か参加者のプロジェクト */
export interface CloudProject {
  id: string
  title: string
  updatedAt: string
  role: 'owner' | 'editor' | 'commenter' | 'viewer'
}

/** CLI が使う workers/api の口。HTTP エラーは readApiError の Error を、検証に通らない応答は Error を throw する */
export interface ApiClient {
  /** `POST /v1/ai/plan-pages` */
  planPages(req: PagePlanRequest): Promise<PagePlanResponse>
  /** `GET /v1/projects`。新しい順 */
  listProjects(): Promise<CloudProject[]>
  /** `GET /v1/projects/:id` の本文 */
  getProject(id: string): Promise<Project>
  /** `POST /v1/projects/:id/sync-ticket` で接続チケットを発行し、それを載せた共同編集の WebSocket URL を返す */
  syncUrl(id: string): Promise<string>
  /** `POST /v1/projects` で空のプロジェクトを作り、それと PUT の If-Match に渡す ETag を返す */
  createProject(title: string): Promise<{ project: Project; etag: string }>
  /** `PUT /v1/projects/:id` で本文を置き換える */
  putProject(project: Project, etag: string): Promise<void>
  /** `POST /v1/auth/sign-out` でセッションを消す */
  signOut(): Promise<void>
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  const doFetch = opts.fetch ?? fetch
  const authHeaders: Record<string, string> =
    'token' in opts.auth
      ? { authorization: `Bearer ${opts.auth.token}` }
      : { 'x-debug-user': opts.auth.debugUser }

  async function send(method: string, path: string, body?: unknown, headers = {}) {
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: { ...authHeaders, 'content-type': 'application/json', ...headers },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
    if (!res.ok) throw await readApiError(res, `${method} ${path}`)
    return res
  }

  return {
    async planPages(req) {
      const res = await send('POST', '/v1/ai/plan-pages', req)
      return PagePlanResponseSchema.parse(await res.json())
    },
    async listProjects() {
      const res = await send('GET', '/v1/projects')
      return ((await res.json()) as { projects: CloudProject[] }).projects
    },
    async getProject(id) {
      const res = await send('GET', `/v1/projects/${encodeURIComponent(id)}`)
      return parseProject(await res.json())
    },
    async syncUrl(id) {
      const path = `/v1/projects/${encodeURIComponent(id)}`
      const res = await send('POST', `${path}/sync-ticket`)
      const { ticket } = (await res.json()) as { ticket: string }
      const url = new URL(`${baseUrl}${path}/sync`)
      url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
      url.searchParams.set('ticket', ticket)
      return url.toString()
    },
    async createProject(title) {
      const res = await send('POST', '/v1/projects', { title })
      const etag = res.headers.get('etag')
      if (etag === null) throw new Error('POST /v1/projects: no etag')
      return { project: parseProject(await res.json()), etag }
    },
    async putProject(project, etag) {
      await send('PUT', `/v1/projects/${encodeURIComponent(project.id)}`, project, {
        'if-match': etag,
      })
    },
    async signOut() {
      await send('POST', '/v1/auth/sign-out')
    },
  }
}

if (import.meta.vitest) {
  const { expect, test, vi } = import.meta.vitest
  const { aiFixtures } = await import('@manga/ai')
  const { ApiError, createEmptyProject, fixtures } = await import('@manga/schema')

  const { settings, characters } = fixtures.samplePage01
  const req = { project: { settings, characters }, script: 'E「……」' }

  test('planPages posts the request with the bearer token and validates the reply', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.test/v1/ai/plan-pages')
      expect(init.headers).toMatchObject({ authorization: 'Bearer tok' })
      expect(JSON.parse(init.body as string)).toEqual(req)
      return Response.json(aiFixtures.pagePlan)
    })
    const client = createApiClient({
      baseUrl: 'https://api.test/',
      auth: { token: 'tok' },
      fetch: fetchMock as typeof fetch,
    })
    expect(await client.planPages(req)).toEqual(aiFixtures.pagePlan)

    const invalid = createApiClient({
      baseUrl: 'https://api.test',
      auth: { token: 'tok' },
      fetch: (async () => Response.json([{ note: 1 }])) as typeof fetch,
    })
    await expect(invalid.planPages(req)).rejects.toThrow()
  })

  test('the debug user goes in X-Debug-User instead of a token', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ 'x-debug-user': 'alice' })
      expect(init.headers).not.toHaveProperty('authorization')
      return new Response(null, { status: 200 })
    })
    const client = createApiClient({
      baseUrl: 'http://localhost:8787',
      auth: { debugUser: 'alice' },
      fetch: fetchMock as typeof fetch,
    })
    await client.signOut()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  test('createProject returns the project with its etag, and putProject sends it as If-Match', async () => {
    const project = createEmptyProject('t')
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        expect(JSON.parse(init.body as string)).toEqual({ title: 't' })
        return Response.json(project, { status: 201, headers: { etag: '"v1"' } })
      }
      expect(url).toBe(`https://api.test/v1/projects/${project.id}`)
      expect(init.headers).toMatchObject({ 'if-match': '"v1"' })
      return Response.json({ updatedAt: 'x' })
    })
    const client = createApiClient({
      baseUrl: 'https://api.test',
      auth: { token: 'tok' },
      fetch: fetchMock as typeof fetch,
    })
    const created = await client.createProject('t')
    expect(created).toEqual({ project, etag: '"v1"' })
    await client.putProject(created.project, created.etag)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('lists and reads projects, and turns a sync ticket into a WebSocket URL', async () => {
    const project = createEmptyProject('t')
    const row = { id: project.id, title: 't', updatedAt: project.updatedAt, role: 'owner' }
    const fetchMock = vi.fn(async (url: string) => {
      const { pathname } = new URL(url)
      if (pathname === '/v1/projects') return Response.json({ projects: [row] })
      if (pathname.endsWith('/sync-ticket')) return Response.json({ ticket: 'tk' }, { status: 201 })
      return Response.json(project)
    })
    const client = createApiClient({
      baseUrl: 'http://localhost:8787',
      auth: { token: 'tok' },
      fetch: fetchMock as typeof fetch,
    })
    expect(await client.listProjects()).toEqual([row])
    expect(await client.getProject(project.id)).toEqual(project)
    expect(await client.syncUrl('p 1')).toBe('ws://localhost:8787/v1/projects/p%201/sync?ticket=tk')
  })

  test('an error reply becomes an ApiError', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.test',
      auth: { token: 'tok' },
      fetch: (async () =>
        Response.json({ code: 'unauthorized' }, { status: 401 })) as unknown as typeof fetch,
    })
    await expect(client.createProject('t')).rejects.toBeInstanceOf(ApiError)
  })
}
