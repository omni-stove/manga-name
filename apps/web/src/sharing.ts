import type { ID } from '@manga/schema'

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

async function failure(res: Response, what: string) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return new Error(`${what}: ${res.status} ${body?.error ?? res.statusText}`)
}

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
    if (!res.ok) throw await failure(res, what)
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
