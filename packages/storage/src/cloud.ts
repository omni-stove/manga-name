import { type ID, type ISODate, newId, type Project, parseProject } from '@manga/schema'
import { byUpdatedAtDesc, type ProjectSummary, type StorageAdapter } from './adapter'

/** ローカルのプロジェクト 1 件と、それに対応するクラウドのプロジェクトの同期記録 */
export interface CloudLink {
  /**
   * クラウド側の id。API の POST はクライアントの id を受け取らずに採番するので、
   * ローカルで作ったプロジェクトはローカルの id と違う
   */
  cloudId: ID
  /** 最後に同期したときのクラウドの updated_at。PUT の If-Match に使う */
  etag: string
  /** 最後に同期したときのローカルの updatedAt。今のローカルと違えば未送信の変更がある。null は未送信 */
  syncedUpdatedAt: ISODate | null
}

/** ローカルの id ごとの CloudLink の置き場。リロードをまたいで残る必要がある */
export interface CloudLinkStore {
  get(localId: ID): Promise<CloudLink | undefined>
  set(localId: ID, link: CloudLink): Promise<void>
  delete(localId: ID): Promise<void>
  entries(): Promise<[ID, CloudLink][]>
}

export interface CloudStorageOptions {
  /** workers/api のオリジン。末尾の `/` は無視する */
  baseUrl: string
  /** Bearer トークン。null は未ログインで、クラウドには触れずローカルだけで動く */
  getToken(): Promise<string | null>
  /** 書き込みを即時に受け、クラウドが使えないときの読み込み元にもなるアダプタ */
  local: StorageAdapter
  /** 既定は localStorage、無い環境ではメモリ */
  links?: CloudLinkStore
  /** 最後の saveProject からクラウドへ送るまでの待ち時間。既定 2 秒 */
  debounceMs?: number
  /** 送信の失敗を再試行しないと決めたときに呼ぶ。既定は console.warn */
  onError?: (error: unknown) => void
  fetch?: typeof fetch
}

export interface CloudStorage extends StorageAdapter {
  /** debounce 待ちの送信を今すぐ行い、送信中のものも含めて終わるまで待つ */
  flush(): Promise<void>
  /** タイマーとイベントリスナを外す。以降の送信は行わない */
  dispose(): void
}

const DEFAULT_DEBOUNCE_MS = 2000
const FIRST_RETRY_MS = 1000
const MAX_RETRY_MS = 5 * 60 * 1000
/** 1 回の送信で PUT をやり直す上限。409 のたびにクラウド版を別名で残すので、無制限だと複製が増え続ける */
const MAX_PUTS_PER_PUSH = 4
const LINKS_KEY = 'manga.cloud-links'

/** 競合したクラウド版を別名で残すときのタイトル */
export const conflictCopyTitle = (title: string) => `${title}（クラウド版）`

/** POST は trim 後 1〜200 文字のタイトルだけを受け付ける。本文は直後の PUT で上書きされるので、初期値だけ収める */
const postTitle = (title: string) => title.trim().slice(0, 200) || '無題'

/** メモリだけに CloudLink を持つ。リロードで消える */
export function createMemoryLinkStore(): CloudLinkStore {
  const map = new Map<ID, CloudLink>()
  return {
    async get(localId) {
      return map.get(localId)
    },
    async set(localId, link) {
      map.set(localId, { ...link })
    },
    async delete(localId) {
      map.delete(localId)
    },
    async entries() {
      return [...map]
    },
  }
}

/** storage の 1 キーに、全プロジェクトの CloudLink を 1 つの JSON として持つ */
function createWebStorageLinkStore(storage: Storage): CloudLinkStore {
  const read = (): Record<ID, CloudLink> => {
    try {
      return JSON.parse(storage.getItem(LINKS_KEY) ?? '{}')
    } catch {
      return {}
    }
  }
  const write = (all: Record<ID, CloudLink>) => storage.setItem(LINKS_KEY, JSON.stringify(all))
  return {
    async get(localId) {
      return read()[localId]
    },
    async set(localId, link) {
      write({ ...read(), [localId]: link })
    },
    async delete(localId) {
      const { [localId]: _, ...rest } = read()
      write(rest)
    },
    async entries() {
      return Object.entries(read())
    },
  }
}

function createDefaultLinkStore(): CloudLinkStore {
  try {
    const storage = globalThis.localStorage
    // Node は --localstorage-file が無いと、メソッドを持たない localStorage を置くことがある
    if (typeof storage?.getItem === 'function') return createWebStorageLinkStore(storage)
  } catch {
    // Safari のプライベートモードなどでは参照しただけで throw する
  }
  return createMemoryLinkStore()
}

type Fetched = { status: 'ok'; project: Project; etag: string } | { status: 'not-found' }

type PushOutcome = 'done' | 'retry' | 'failed'

interface PushState {
  timer?: ReturnType<typeof setTimeout>
  /** 実行中の送信。送信は 1 プロジェクトにつき 1 本だけ走らせる */
  running?: Promise<void>
  /** 送信中に来た saveProject。送信が終わったらもう一度送る */
  again: boolean
  failures: number
}

/** 引用符付きの強い ETag から値を取り出す */
const parseEtag = (header: string | null) => header?.match(/^\s*"([^"]+)"/)?.[1]

const isNetworkError = (e: unknown) => e instanceof TypeError

/**
 * ローカル優先でクラウドに同期する StorageAdapter（docs/workstreams/WS-15-cloud-storage.md）。
 * - saveProject は local に書いて返し、クラウドへは debounceMs 後にバックグラウンドで PUT する。
 *   失敗は指数バックオフ（上限 5 分）で再試行し、オフラインなら online イベントで再開する。
 * - loadProject はクラウドの版と比べ、変更があった側を採用する。両方に変更があれば競合として扱う。
 * - PUT が 409 のときはクラウド版を「（クラウド版）」付きの別プロジェクトとしてローカルに保存して
 *   クラウドにも新規で送り、手元の版でクラウドを上書きする。どちらの版も両方に残る。
 * - アセットは local に委ねる。
 */
export function createCloudStorage(opts: CloudStorageOptions): CloudStorage {
  const { local, getToken } = opts
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  const links = opts.links ?? createDefaultLinkStore()
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const onError = opts.onError ?? ((e: unknown) => console.warn('cloud sync failed', e))
  // 呼ぶたびに globalThis.fetch を引くのは、作成後に差し替えられた fetch（msw など）も通すため
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const pushes = new Map<ID, PushState>()
  let disposed = false

  const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

  /** トークンが無ければ null。ネットワークの失敗は TypeError のまま throw する */
  async function request(path: string, init: RequestInit = {}): Promise<Response | null> {
    const token = await getToken()
    if (token === null) return null
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    return doFetch(`${baseUrl}/v1/projects${path}`, { ...init, headers })
  }

  const unexpected = async (res: Response, what: string) =>
    new Error(`${what} failed: ${res.status} ${await res.text().catch(() => '')}`.trim())

  /** トークンが無ければ null */
  async function fetchProject(cloudId: ID): Promise<Fetched | null> {
    const res = await request(`/${encodeURIComponent(cloudId)}`)
    if (res === null) return null
    if (res.status === 404) return { status: 'not-found' }
    if (!res.ok) throw await unexpected(res, `GET project ${cloudId}`)
    const project = parseProject(await res.json())
    // ETag を読めない CORS 設定でも、サーバは本文の updatedAt を updated_at に揃えて保存している
    return { status: 'ok', project, etag: parseEtag(res.headers.get('etag')) ?? project.updatedAt }
  }

  /** クラウドの版をローカルの id で保存し、同期済みとして記録する */
  async function adopt(localId: ID, cloudId: ID, remote: { project: Project; etag: string }) {
    const project = { ...remote.project, id: localId }
    await local.saveProject(project)
    await links.set(localId, { cloudId, etag: remote.etag, syncedUpdatedAt: project.updatedAt })
    return project
  }

  /** クラウド版を別名の新しいローカルプロジェクトとして残し、クラウドにも新規で送る */
  async function keepCloudCopy(remote: Project) {
    const copy = { ...remote, id: newId(), title: conflictCopyTitle(remote.title) }
    await local.saveProject(copy)
    schedule(copy.id, 0)
  }

  /** POST で採番されたクラウドのプロジェクトを作り、未送信として記録する */
  async function createRemote(localId: ID, title: string): Promise<CloudLink | null> {
    const res = await request('', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: postTitle(title) }),
    })
    if (res === null) return null
    if (!res.ok) throw await unexpected(res, 'POST project')
    const created = parseProject(await res.json())
    const link = {
      cloudId: created.id,
      etag: parseEtag(res.headers.get('etag')) ?? created.updatedAt,
      syncedUpdatedAt: null,
    }
    await links.set(localId, link)
    return link
  }

  async function push(localId: ID): Promise<PushOutcome> {
    let project: Project
    try {
      project = await local.loadProject(localId)
    } catch {
      // debounce の間に消されたプロジェクトは送らない
      return 'done'
    }
    let link = await links.get(localId)
    if (link?.syncedUpdatedAt === project.updatedAt) return 'done'

    for (let attempt = 0; attempt < MAX_PUTS_PER_PUSH; attempt++) {
      if (!link) {
        const created = await createRemote(localId, project.title)
        if (created === null) return 'retry'
        link = created
      }
      const res = await request(`/${encodeURIComponent(link.cloudId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'if-match': `"${link.etag}"` },
        body: JSON.stringify({ ...project, id: link.cloudId }),
      })
      if (res === null) return 'retry'
      if (res.ok) {
        const body = (await res.json()) as { updatedAt?: string }
        const etag = parseEtag(res.headers.get('etag')) ?? body.updatedAt
        if (!etag) throw new Error('PUT project returned no updatedAt')
        await links.set(localId, {
          cloudId: link.cloudId,
          etag,
          syncedUpdatedAt: project.updatedAt,
        })
        return 'done'
      }
      if (res.status === 404) {
        // 別の端末で消されたクラウド側を、手元に残っている版で作り直す
        await links.delete(localId)
        link = undefined
        continue
      }
      if (res.status === 409) {
        const remote = await fetchProject(link.cloudId)
        if (remote === null) return 'retry'
        if (remote.status === 'not-found') {
          await links.delete(localId)
          link = undefined
          continue
        }
        await keepCloudCopy(remote.project)
        link = { ...link, etag: remote.etag }
        await links.set(localId, link)
        continue
      }
      if (res.status === 429 || res.status >= 500) return 'retry'
      onError(await unexpected(res, `PUT project ${link.cloudId}`))
      return 'failed'
    }
    return 'retry'
  }

  function stateOf(id: ID): PushState {
    let state = pushes.get(id)
    if (!state) {
      state = { again: false, failures: 0 }
      pushes.set(id, state)
    }
    return state
  }

  function schedule(id: ID, delay: number) {
    if (disposed) return
    const state = stateOf(id)
    if (state.running) {
      state.again = true
      return
    }
    clearTimeout(state.timer)
    state.timer = setTimeout(() => void run(id), delay)
  }

  function run(id: ID): Promise<void> {
    const state = stateOf(id)
    clearTimeout(state.timer)
    state.timer = undefined
    if (state.running) {
      state.again = true
      return state.running
    }
    state.running = (async () => {
      let outcome: PushOutcome
      if (isOffline()) {
        outcome = 'retry'
      } else {
        try {
          outcome = await push(id)
        } catch (e) {
          // fetch の TypeError はオフラインや DNS の一時的な失敗なので、送れるまで再試行する
          if (!isNetworkError(e)) onError(e)
          outcome = isNetworkError(e) ? 'retry' : 'failed'
        }
      }
      state.running = undefined
      if (outcome === 'retry') {
        state.failures++
        state.again = false
        if (disposed) return
        const delay = Math.min(FIRST_RETRY_MS * 2 ** (state.failures - 1), MAX_RETRY_MS)
        state.timer = setTimeout(() => void run(id), delay)
        return
      }
      state.failures = 0
      if (state.again) {
        state.again = false
        schedule(id, debounceMs)
      } else {
        pushes.delete(id)
      }
    })()
    return state.running
  }

  const isPending = (id: ID) => pushes.has(id)

  const onOnline = () => {
    for (const [id, state] of pushes) {
      if (state.timer !== undefined && state.failures > 0) void run(id)
    }
  }
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline)

  async function loadLinked(id: ID): Promise<Project> {
    const localProject = await local.loadProject(id).catch(() => undefined)
    // 未送信の変更があるあいだにクラウドの版を採用すると、その変更を上書きしてしまう
    if (localProject && isPending(id)) return localProject

    const link = await links.get(id)
    const cloudId = link?.cloudId ?? id
    let remote: Fetched | null
    try {
      remote = await fetchProject(cloudId)
    } catch (e) {
      if (localProject) return localProject
      throw e
    }

    if (remote === null) {
      if (localProject) return localProject
      throw new Error(`Project not found: ${id}`)
    }
    if (remote.status === 'not-found') {
      if (!localProject) throw new Error(`Project not found: ${id}`)
      if (link) await links.delete(id)
      schedule(id, debounceMs)
      return localProject
    }
    if (!localProject) return adopt(id, cloudId, remote)

    if (!link) {
      // 同期記録を失ったときは、仕様どおり updatedAt の新しい方を採用する
      if (remote.project.updatedAt > localProject.updatedAt) return adopt(id, cloudId, remote)
      const same = remote.project.updatedAt === localProject.updatedAt
      await links.set(id, {
        cloudId,
        etag: remote.etag,
        syncedUpdatedAt: same ? localProject.updatedAt : null,
      })
      if (!same) schedule(id, debounceMs)
      return localProject
    }

    const cloudChanged = link.etag !== remote.etag
    const localChanged = link.syncedUpdatedAt !== localProject.updatedAt
    if (cloudChanged && !localChanged) return adopt(id, cloudId, remote)
    if (cloudChanged) {
      await keepCloudCopy(remote.project)
      await links.set(id, { ...link, etag: remote.etag })
    }
    if (localChanged) schedule(id, debounceMs)
    return localProject
  }

  return {
    async listProjects() {
      const [localList, entries] = await Promise.all([local.listProjects(), links.entries()])
      let remote: ProjectSummary[] = []
      try {
        const res = await request('')
        if (res?.ok) remote = ((await res.json()) as { projects: ProjectSummary[] }).projects
      } catch {
        // オフラインでもローカルの一覧は出す
      }
      const localIds = new Set(localList.map((p) => p.id))
      const linked = new Set(entries.filter(([id]) => localIds.has(id)).map(([, l]) => l.cloudId))
      const cloudOnly = remote.filter((p) => !linked.has(p.id) && !localIds.has(p.id))
      return [...localList, ...cloudOnly].sort(byUpdatedAtDesc)
    },
    loadProject: loadLinked,
    async saveProject(p) {
      await local.saveProject(p)
      schedule(p.id, debounceMs)
    },
    async deleteProject(id) {
      const state = pushes.get(id)
      clearTimeout(state?.timer)
      pushes.delete(id)
      await state?.running
      const link = await links.get(id)
      if (link) {
        // クラウドへの DELETE が済む前にローカルだけ消すと、未ログインや失敗のあとで一覧にクラウド側が戻ってくる
        const res = await request(`/${encodeURIComponent(link.cloudId)}`, { method: 'DELETE' })
        if (res === null) throw new Error(`DELETE project ${link.cloudId} needs a token`)
        if (!res.ok && res.status !== 404) {
          throw await unexpected(res, `DELETE project ${link.cloudId}`)
        }
      }
      await local.deleteProject(id)
      await links.delete(id)
    },
    resolveAsset: (ref) => local.resolveAsset(ref),
    loadAsset: (ref) => local.loadAsset(ref),
    putAsset: (projectId, blob, hint) => local.putAsset(projectId, blob, hint),
    async flush() {
      // 送信が別のプロジェクトの送信（競合時の複製）を予約するので、予約が尽きるまで繰り返す
      // 再試行待ちになったものは 2 周目以降は待たず、バックオフに任せる
      let ids = [...pushes.keys()]
      while (ids.length > 0) {
        await Promise.all(ids.map((id) => run(id)))
        ids = [...pushes].filter(([, s]) => s.failures === 0).map(([id]) => id)
      }
    },
    dispose() {
      disposed = true
      for (const state of pushes.values()) clearTimeout(state.timer)
      pushes.clear()
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
    },
  }
}

if (import.meta.vitest) {
  const { http, HttpResponse } = await import('msw')
  const { setupServer } = await import('msw/node')
  const { createEmptyProject } = await import('@manga/schema')
  const { summarize } = await import('./adapter')
  const { createMemoryStorage } = await import('./memory')
  const { afterAll, afterEach, beforeAll, describe, expect, test, vi } = import.meta.vitest

  const BASE = 'https://api.test'
  const TOKEN = 'token'

  /** workers/api の /v1/projects を真似る。updated_at はサーバの時計で進み、PUT は If-Match が違うと 409 */
  const createFakeApi = () => {
    const rows = new Map<ID, Project>()
    const requests: string[] = []
    let clock = Date.now()
    const tick = () => {
      clock += 1000
      return new Date(clock).toISOString()
    }
    const etag = (p: Project) => ({ etag: `"${p.updatedAt}"` })
    const accept = (request: Request) => {
      requests.push(`${request.method} ${new URL(request.url).pathname}`)
      return request.headers.get('authorization') === `Bearer ${TOKEN}`
    }
    const unauthorized = () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
    const notFound = () => HttpResponse.json({ error: 'not found' }, { status: 404 })

    const handlers = [
      http.get(`${BASE}/v1/projects`, ({ request }) => {
        if (!accept(request)) return unauthorized()
        return HttpResponse.json({ projects: [...rows.values()].map(summarize) })
      }),
      http.post(`${BASE}/v1/projects`, async ({ request }) => {
        if (!accept(request)) return unauthorized()
        const { title } = (await request.json()) as { title: string }
        const created = { ...createEmptyProject(title), updatedAt: tick() }
        rows.set(created.id, created)
        return HttpResponse.json(created, { status: 201, headers: etag(created) })
      }),
      http.get(`${BASE}/v1/projects/:id`, ({ request, params }) => {
        if (!accept(request)) return unauthorized()
        const found = rows.get(String(params.id))
        return found ? HttpResponse.json(found, { headers: etag(found) }) : notFound()
      }),
      http.put(`${BASE}/v1/projects/:id`, async ({ request, params }) => {
        if (!accept(request)) return unauthorized()
        const current = rows.get(String(params.id))
        if (!current) return notFound()
        if (request.headers.get('if-match') !== `"${current.updatedAt}"`) {
          return HttpResponse.json(
            { error: 'project was updated elsewhere', updatedAt: current.updatedAt },
            { status: 409, headers: etag(current) },
          )
        }
        const saved = { ...parseProject(await request.json()), updatedAt: tick() }
        if (saved.id !== current.id) return HttpResponse.json({ error: 'id' }, { status: 400 })
        rows.set(saved.id, saved)
        return HttpResponse.json({ updatedAt: saved.updatedAt }, { headers: etag(saved) })
      }),
      http.delete(`${BASE}/v1/projects/:id`, ({ request, params }) => {
        if (!accept(request)) return unauthorized()
        return rows.delete(String(params.id)) ? new HttpResponse(null, { status: 204 }) : notFound()
      }),
    ]
    return { rows, requests, handlers }
  }

  const server = setupServer()
  const devices: CloudStorage[] = []
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => {
    for (const d of devices.splice(0)) d.dispose()
    server.resetHandlers()
  })
  afterAll(() => server.close())

  const useApi = () => {
    const api = createFakeApi()
    server.use(...api.handlers)
    return api
  }

  /** 1 台のブラウザ。debounce は既定で長くし、送信は flush で起こす */
  const createDevice = (overrides: Partial<CloudStorageOptions> = {}) => {
    const local = overrides.local ?? createMemoryStorage()
    const links = overrides.links ?? createMemoryLinkStore()
    const errors: unknown[] = []
    const storage = createCloudStorage({
      baseUrl: `${BASE}/`,
      getToken: async () => TOKEN,
      debounceMs: 60_000,
      onError: (e) => errors.push(e),
      ...overrides,
      local,
      links,
    })
    devices.push(storage)
    return { storage, local, links, errors }
  }

  const cloudIdOf = async (links: CloudLinkStore, localId: ID) => {
    const link = await links.get(localId)
    if (!link) throw new Error(`not linked: ${localId}`)
    return link.cloudId
  }

  /** アプリの ProjectStore と同じく、変更のたびに updatedAt を進める */
  const edit = (p: Project, title: string): Project => ({
    ...p,
    title,
    updatedAt: new Date(Date.parse(p.updatedAt) + 1).toISOString(),
  })

  describe('createCloudStorage', () => {
    test('saveProject writes locally at once and creates the cloud project later', async () => {
      const api = useApi()
      const { storage, local, links, errors } = createDevice()
      const p = createEmptyProject('A')
      await storage.saveProject(p)
      expect(await local.loadProject(p.id)).toEqual(p)
      expect(api.requests).toEqual([])

      await storage.flush()
      const cloudId = await cloudIdOf(links, p.id)
      expect(api.requests).toEqual(['POST /v1/projects', `PUT /v1/projects/${cloudId}`])
      const stored = api.rows.get(cloudId)
      expect({ ...stored, id: p.id, updatedAt: p.updatedAt }).toEqual(p)
      expect(errors).toEqual([])
    })

    test('consecutive saves are sent once, after debounceMs', async () => {
      const api = useApi()
      const { storage, links } = createDevice({ debounceMs: 20 })
      const p = createEmptyProject('A')
      await storage.saveProject(p)
      await storage.saveProject(edit(p, 'B'))
      expect(api.requests).toEqual([])

      await vi.waitFor(() => expect(api.requests).toHaveLength(2))
      expect(api.rows.get(await cloudIdOf(links, p.id))?.title).toBe('B')
    })

    test('later saves update the same cloud project with If-Match', async () => {
      const api = useApi()
      const { storage, links, errors } = createDevice()
      const p = createEmptyProject('A')
      await storage.saveProject(p)
      await storage.flush()
      await storage.saveProject(edit(p, 'B'))
      await storage.flush()

      const cloudId = await cloudIdOf(links, p.id)
      expect(api.requests.slice(2)).toEqual([`PUT /v1/projects/${cloudId}`])
      expect(api.rows.size).toBe(1)
      expect(api.rows.get(cloudId)?.title).toBe('B')
      expect(errors).toEqual([])
    })

    test('a second device lists, loads and saves the same cloud project', async () => {
      const api = useApi()
      const a = createDevice()
      const p = createEmptyProject('A')
      await a.storage.saveProject(p)
      await a.storage.flush()
      const cloudId = await cloudIdOf(a.links, p.id)

      const b = createDevice()
      expect(await b.storage.listProjects()).toEqual([
        { id: cloudId, title: 'A', updatedAt: api.rows.get(cloudId)?.updatedAt },
      ])
      const loaded = await b.storage.loadProject(cloudId)
      expect(loaded).toEqual(api.rows.get(cloudId))
      expect(await b.local.loadProject(cloudId)).toEqual(loaded)

      await b.storage.saveProject(edit(loaded, 'from B'))
      await b.storage.flush()
      expect(api.rows.size).toBe(1)
      expect(api.rows.get(cloudId)?.title).toBe('from B')
      expect(b.errors).toEqual([])
    })

    test('loadProject adopts a newer cloud version over an unedited local copy', async () => {
      useApi()
      const a = createDevice()
      const p = createEmptyProject('A')
      await a.storage.saveProject(p)
      await a.storage.flush()
      const cloudId = await cloudIdOf(a.links, p.id)
      const b = createDevice()
      const loaded = await b.storage.loadProject(cloudId)
      await b.storage.saveProject(edit(loaded, 'from B'))
      await b.storage.flush()

      expect((await a.storage.loadProject(p.id)).title).toBe('from B')
      expect((await a.local.loadProject(p.id)).title).toBe('from B')
    })

    test('a 409 keeps both versions, locally and in the cloud', async () => {
      const api = useApi()
      const a = createDevice()
      const p = createEmptyProject('A')
      await a.storage.saveProject(p)
      await a.storage.flush()
      const cloudId = await cloudIdOf(a.links, p.id)
      const b = createDevice()
      const loaded = await b.storage.loadProject(cloudId)

      await a.storage.saveProject(edit(p, 'from A'))
      await a.storage.flush()
      await b.storage.saveProject(edit(loaded, 'from B'))
      await b.storage.flush()

      expect((await b.local.loadProject(cloudId)).title).toBe('from B')
      expect((await b.local.listProjects()).map((s) => s.title).sort()).toEqual(
        [conflictCopyTitle('from A'), 'from B'].sort(),
      )
      expect(api.rows.get(cloudId)?.title).toBe('from B')
      expect([...api.rows.values()].map((r) => r.title).sort()).toEqual(
        [conflictCopyTitle('from A'), 'from B'].sort(),
      )
      expect(b.errors).toEqual([])

      expect((await a.storage.loadProject(p.id)).title).toBe('from B')
      expect((await a.storage.listProjects()).map((s) => s.title)).toContain(
        conflictCopyTitle('from A'),
      )
    })

    test('loadProject after a reload with edits on both sides keeps both versions', async () => {
      const api = useApi()
      const a = createDevice()
      const p = createEmptyProject('A')
      await a.storage.saveProject(p)
      await a.storage.flush()
      const cloudId = await cloudIdOf(a.links, p.id)

      const b = createDevice()
      const loaded = await b.storage.loadProject(cloudId)
      await b.storage.saveProject(edit(loaded, 'from B'))
      // 送信前に閉じたブラウザを、同じローカルデータで開き直す
      b.storage.dispose()
      await a.storage.saveProject(edit(p, 'from A'))
      await a.storage.flush()
      const reopened = createDevice({ local: b.local, links: b.links })

      expect((await reopened.storage.loadProject(cloudId)).title).toBe('from B')
      expect((await reopened.local.listProjects()).map((s) => s.title)).toContain(
        conflictCopyTitle('from A'),
      )
      await reopened.storage.flush()
      expect([...api.rows.values()].map((r) => r.title).sort()).toEqual(
        [conflictCopyTitle('from A'), 'from B'].sort(),
      )
      expect(reopened.errors).toEqual([])
    })

    test('a network failure is retried with backoff', async () => {
      const api = useApi()
      server.use(http.put(`${BASE}/v1/projects/:id`, () => HttpResponse.error(), { once: true }))
      const { storage, links, errors } = createDevice()
      const p = createEmptyProject('A')
      await storage.saveProject(p)
      await storage.flush()
      const cloudId = await cloudIdOf(links, p.id)
      expect(api.rows.has(cloudId)).toBe(true)
      expect(api.requests).toEqual(['POST /v1/projects'])

      await vi.waitFor(() => expect(api.requests).toHaveLength(2), { timeout: 3000 })
      await vi.waitFor(async () =>
        expect((await links.get(p.id))?.syncedUpdatedAt).toBe(p.updatedAt),
      )
      expect(errors).toEqual([])
    })

    test('without a token it works on the local storage and sends nothing', async () => {
      const api = useApi()
      const { storage } = createDevice({ getToken: async () => null })
      const p = createEmptyProject('A')
      await storage.saveProject(p)
      await storage.flush()
      expect(await storage.loadProject(p.id)).toEqual(p)
      expect(await storage.listProjects()).toEqual([summarize(p)])
      expect(api.requests).toEqual([])
    })

    test('loadProject falls back to the local copy while the API is unreachable', async () => {
      useApi()
      const { storage, local } = createDevice()
      const p = createEmptyProject('A')
      await local.saveProject(p)
      server.use(http.get(`${BASE}/v1/projects/*`, () => HttpResponse.error()))
      server.use(http.get(`${BASE}/v1/projects`, () => HttpResponse.error()))
      expect(await storage.loadProject(p.id)).toEqual(p)
      expect(await storage.listProjects()).toEqual([summarize(p)])
    })

    test('deleteProject removes the project locally and in the cloud', async () => {
      const api = useApi()
      const { storage, local, links } = createDevice()
      const p = createEmptyProject('A')
      await storage.saveProject(p)
      await storage.flush()
      const cloudId = await cloudIdOf(links, p.id)

      await storage.deleteProject(p.id)
      await expect(local.loadProject(p.id)).rejects.toThrow(/not found/)
      expect(api.rows.has(cloudId)).toBe(false)
      expect(await links.get(p.id)).toBeUndefined()
      expect(await storage.listProjects()).toEqual([])
    })

    test('deleteProject keeps a synced project while signed out', async () => {
      const api = useApi()
      const { storage, local, links } = createDevice()
      const p = createEmptyProject('A')
      await storage.saveProject(p)
      await storage.flush()
      const cloudId = await cloudIdOf(links, p.id)

      const signedOut = createDevice({ local, links, getToken: async () => null })
      await expect(signedOut.storage.deleteProject(p.id)).rejects.toThrow(/needs a token/)
      expect(await local.loadProject(p.id)).toEqual(p)
      expect(api.rows.has(cloudId)).toBe(true)
      expect(await links.get(p.id)).toBeDefined()
    })
  })
}
