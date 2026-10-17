import { type ID, readApiError } from '@manga/schema'

/** workers/api の ProjectRole。owner はプロジェクトを作った人 */
export type ProjectRole = 'owner' | 'editor' | 'commenter' | 'viewer'
export type MemberRole = Exclude<ProjectRole, 'owner'>

export const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: 'オーナー',
  editor: '編集者',
  commenter: '手描きメモのみ',
  viewer: '閲覧のみ',
}

interface Member {
  userId: string
  role: ProjectRole
  email: string | null
  name: string | null
}

interface PendingInvite {
  id: string
  email: string
  role: MemberRole
  expiresAt: string
}

export interface Members {
  /** 自分のロール */
  role: ProjectRole
  members: Member[]
  /** owner のときだけ入る */
  invites: PendingInvite[]
}

export interface InvitePreview {
  email: string
  role: MemberRole
  projectId: ID
  projectTitle: string
  expiresAt: string
}

export interface SharingClient {
  /**
   * 自分のロール。クラウドに無いプロジェクトと未ログインは owner。
   * 取れなければ最後に取れたロールを使い、それも無ければ owner
   */
  role(localId: ID): Promise<ProjectRole>
  /** 参加者と招待。クラウドに無いプロジェクトか未ログインなら null */
  members(localId: ID): Promise<Members | null>
  /** 招待を作り、受け取る人に渡すリンクを返す */
  invite(
    localId: ID,
    email: string,
    role: MemberRole,
  ): Promise<{ invite: PendingInvite; url: string }>
  revokeInvite(localId: ID, inviteId: string): Promise<void>
  setRole(localId: ID, userId: string, role: MemberRole): Promise<void>
  removeMember(localId: ID, userId: string): Promise<void>
  /** 招待リンクのトークンの中身。無いか期限切れなら null */
  previewInvite(token: string): Promise<InvitePreview | null>
  /** 招待を受け取り、参加したプロジェクトの id（クラウドの id）を返す。招待先と違うメールアドレスなら throw */
  acceptInvite(token: string): Promise<ID>
}

export interface SharingClientOptions {
  /** workers/api のオリジン。空なら API が無いものとして、どのプロジェクトも owner */
  baseUrl: string
  /** ログイン中の Bearer を付ける fetch（AuthClient.fetch） */
  fetch: typeof fetch
  /** ローカルの id に対応するクラウドの id。クラウドに無いか未ログインなら null */
  cloudId(localId: ID): Promise<ID | null>
  /** 招待リンクの組み立てに使う apps/web のオリジン。既定は location.origin */
  appOrigin?: string
  /** 最後に取れたロールの置き場。既定は localStorage */
  storage?: Storage
}

const ROLES_KEY = 'manga.project-roles'

/** 招待リンクの、apps/web 側のパス */
const invitePath = (token: string) => `/invite/${encodeURIComponent(token)}`

/** workers/api の参加者と招待の API（`/v1/projects/:id/members` ほか、`/v1/invites/:token`）のクライアント */
export function createSharingClient(opts: SharingClientOptions): SharingClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  const storage = opts.storage ?? globalThis.localStorage

  const readRoles = (): Record<ID, ProjectRole> => {
    try {
      return JSON.parse(storage?.getItem(ROLES_KEY) ?? '{}')
    } catch {
      return {}
    }
  }
  const rememberRole = (localId: ID, role: ProjectRole) => {
    try {
      storage?.setItem(ROLES_KEY, JSON.stringify({ ...readRoles(), [localId]: role }))
    } catch {
      // 覚えられなくても、オフラインで開いたときに owner として扱うだけ
    }
  }

  const call = (path: string, init: RequestInit = {}) =>
    opts.fetch(`${baseUrl}/v1${path}`, {
      ...init,
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    })

  /** クラウドの id のプロジェクトへの path。クラウドに無ければ throw */
  const projectPath = async (localId: ID, rest: string) => {
    const cloudId = baseUrl === '' ? null : await opts.cloudId(localId)
    if (cloudId === null) throw new Error('このプロジェクトはまだクラウドにありません')
    return `/projects/${encodeURIComponent(cloudId)}${rest}`
  }

  const expectOk = async (res: Response, what: string) => {
    if (!res.ok) throw await readApiError(res, what)
  }

  const members = async (localId: ID): Promise<Members | null> => {
    const cloudId = baseUrl === '' ? null : await opts.cloudId(localId)
    if (cloudId === null) return null
    const res = await call(`/projects/${encodeURIComponent(cloudId)}/members`)
    if (res.status === 401 || res.status === 404) return null
    await expectOk(res, 'GET members')
    const body = (await res.json()) as Members
    rememberRole(localId, body.role)
    return body
  }

  return {
    async role(localId) {
      try {
        return (await members(localId))?.role ?? 'owner'
      } catch {
        return readRoles()[localId] ?? 'owner'
      }
    },
    members,
    async invite(localId, email, role) {
      const res = await call(await projectPath(localId, '/invites'), {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      })
      await expectOk(res, 'POST invite')
      const { token, ...invite } = (await res.json()) as PendingInvite & { token: string }
      const origin = opts.appOrigin ?? globalThis.location.origin
      return { invite, url: new URL(invitePath(token), origin).toString() }
    },
    async revokeInvite(localId, inviteId) {
      const path = await projectPath(localId, `/invites/${encodeURIComponent(inviteId)}`)
      await expectOk(await call(path, { method: 'DELETE' }), 'DELETE invite')
    },
    async setRole(localId, userId, role) {
      const path = await projectPath(localId, `/members/${encodeURIComponent(userId)}`)
      const res = await call(path, { method: 'PUT', body: JSON.stringify({ role }) })
      await expectOk(res, 'PUT member')
    },
    async removeMember(localId, userId) {
      const path = await projectPath(localId, `/members/${encodeURIComponent(userId)}`)
      await expectOk(await call(path, { method: 'DELETE' }), 'DELETE member')
    },
    async previewInvite(token) {
      const res = await call(`/invites/${encodeURIComponent(token)}`)
      if (res.status === 404) return null
      await expectOk(res, 'GET invite')
      return (await res.json()) as InvitePreview
    },
    async acceptInvite(token) {
      const res = await call(`/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' })
      if (res.status === 403) throw new Error('この招待は別のメールアドレス宛てです')
      if (res.status === 404) throw new Error('招待が見つからないか、期限が切れています')
      await expectOk(res, 'POST accept invite')
      const { projectId, role } = (await res.json()) as { projectId: ID; role: ProjectRole }
      // 招待で開くプロジェクトはクラウドの id のまま一覧に並ぶので、ローカルの id もクラウドの id になる
      rememberRole(projectId, role)
      return projectId
    },
  }
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest

  const memoryStorage = (): Storage => {
    const items = new Map<string, string>()
    return {
      get length() {
        return items.size
      },
      clear: () => items.clear(),
      getItem: (key) => items.get(key) ?? null,
      key: (i) => [...items.keys()][i] ?? null,
      removeItem: (key) => void items.delete(key),
      setItem: (key, value) => void items.set(key, value),
    }
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  const members: Members = {
    role: 'editor',
    members: [{ userId: 'u1', role: 'editor', email: 'a@example.com', name: 'A' }],
    invites: [],
  }

  const setup = (
    respond: (url: string, init: RequestInit) => Response | Promise<Response>,
    overrides: Partial<SharingClientOptions> = {},
  ) => {
    const fetch = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) =>
      Promise.resolve(respond(String(input), init)),
    )
    const storage = overrides.storage ?? memoryStorage()
    const client = createSharingClient({
      baseUrl: 'https://api.test/',
      fetch: fetch as typeof globalThis.fetch,
      cloudId: async (localId) => (localId === 'local' ? 'cloud 1' : null),
      appOrigin: 'https://app.test',
      ...overrides,
      storage,
    })
    return { client, fetch, storage }
  }

  describe('createSharingClient', () => {
    test('members reads the cloud project and role uses it', async () => {
      const { client, fetch } = setup(() => json(members))
      expect(await client.members('local')).toEqual(members)
      expect(await client.role('local')).toBe('editor')
      expect(fetch).toHaveBeenCalledWith('https://api.test/v1/projects/cloud%201/members', {
        headers: undefined,
      })
    })

    test('a project that is not in the cloud, or no API, is owned without asking the API', async () => {
      const { client, fetch } = setup(() => json(members))
      expect(await client.members('other')).toBeNull()
      expect(await client.role('other')).toBe('owner')
      const noApi = setup(() => json(members), { baseUrl: '' })
      expect(await noApi.client.role('local')).toBe('owner')
      expect(fetch).not.toHaveBeenCalled()
      expect(noApi.fetch).not.toHaveBeenCalled()
    })

    test('members is null when signed out or the project is gone', async () => {
      for (const [status, code] of [
        [401, 'unauthorized'],
        [404, 'not_found'],
      ] as const) {
        const { client } = setup(() => json({ code }, status))
        expect(await client.members('local')).toBeNull()
        expect(await client.role('local')).toBe('owner')
      }
    })

    test('role falls back to the last role it got, then to owner', async () => {
      const storage = memoryStorage()
      const online = setup(() => json({ ...members, role: 'viewer' }), { storage })
      expect(await online.client.role('local')).toBe('viewer')

      const offline = setup(
        () => {
          throw new TypeError('network')
        },
        { storage },
      )
      expect(await offline.client.role('local')).toBe('viewer')
      const failing = setup(() => json({ code: 'internal_error' }, 500), {
        storage: memoryStorage(),
      })
      expect(await failing.client.role('local')).toBe('owner')
      await expect(failing.client.members('local')).rejects.toThrow(
        'GET members: 500 internal_error',
      )
    })

    test('a broken or unwritable role store does not break role', async () => {
      const storage = memoryStorage()
      storage.setItem('manga.project-roles', '{')
      const broken = setup(() => json(members), { storage })
      expect(await broken.client.role('local')).toBe('editor')

      const full = memoryStorage()
      full.setItem = () => {
        throw new DOMException('quota', 'QuotaExceededError')
      }
      const unwritable = setup(() => json(members), { storage: full })
      expect(await unwritable.client.role('local')).toBe('editor')
    })

    test('invite posts the email and role and links to the app', async () => {
      const invite = { id: 'i1', email: 'b@example.com', role: 'commenter', expiresAt: 'x' }
      const { client, fetch } = setup(() => json({ ...invite, token: 'a/b' }))
      expect(await client.invite('local', 'b@example.com', 'commenter')).toEqual({
        invite,
        url: 'https://app.test/invite/a%2Fb',
      })
      expect(fetch).toHaveBeenCalledWith('https://api.test/v1/projects/cloud%201/invites', {
        method: 'POST',
        body: JSON.stringify({ email: 'b@example.com', role: 'commenter' }),
        headers: { 'content-type': 'application/json' },
      })
    })

    test('changes to a project that is not in the cloud throw before calling the API', async () => {
      const { client, fetch } = setup(() => json({}))
      await expect(client.invite('other', 'b@example.com', 'viewer')).rejects.toThrow(
        'まだクラウドにありません',
      )
      await expect(client.removeMember('other', 'u1')).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
    })

    test('revokeInvite, setRole and removeMember call their endpoints and report failures', async () => {
      const { client, fetch } = setup((_url, init) =>
        init.method === 'PUT' ? json({}, 403) : new Response(null, { status: 204 }),
      )
      await client.revokeInvite('local', 'i/1')
      await client.removeMember('local', 'u1')
      await expect(client.setRole('local', 'u1', 'viewer')).rejects.toThrow('PUT member: 403')
      expect(fetch.mock.calls.map(([url, init]) => `${init?.method} ${url}`)).toEqual([
        'DELETE https://api.test/v1/projects/cloud%201/invites/i%2F1',
        'DELETE https://api.test/v1/projects/cloud%201/members/u1',
        'PUT https://api.test/v1/projects/cloud%201/members/u1',
      ])
      expect(fetch.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ role: 'viewer' }))
    })

    test('previewInvite is null for an unknown token', async () => {
      const preview = { email: 'b@example.com', role: 'viewer', projectId: 'c', projectTitle: 'T' }
      const { client } = setup((url) => (url.endsWith('/known') ? json(preview) : json({}, 404)))
      expect(await client.previewInvite('known')).toEqual(preview)
      expect(await client.previewInvite('gone')).toBeNull()
    })

    test('acceptInvite returns the cloud id and remembers the role under it', async () => {
      const storage = memoryStorage()
      const accepted = setup(() => json({ projectId: 'c1', role: 'commenter' }), { storage })
      expect(await accepted.client.acceptInvite('t')).toBe('c1')
      expect(accepted.fetch).toHaveBeenCalledWith('https://api.test/v1/invites/t/accept', {
        method: 'POST',
        headers: undefined,
      })
      const offline = setup(
        () => {
          throw new TypeError('network')
        },
        { storage, cloudId: async () => 'c1' },
      )
      expect(await offline.client.role('c1')).toBe('commenter')
    })

    test('acceptInvite explains a wrong account and an expired invite', async () => {
      const wrong = setup(() => json({}, 403))
      await expect(wrong.client.acceptInvite('t')).rejects.toThrow('別のメールアドレス')
      const expired = setup(() => json({}, 404))
      await expect(expired.client.acceptInvite('t')).rejects.toThrow('期限が切れています')
      const failing = setup(() => new Response('oops', { status: 500, statusText: 'Server Error' }))
      await expect(failing.client.acceptInvite('t')).rejects.toThrow('POST accept invite: 500 oops')
    })
  })
}
