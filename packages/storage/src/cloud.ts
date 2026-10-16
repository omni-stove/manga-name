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
  /**
   * アップロード済みのアセットの、ローカルの ref からクラウドの `r2:` の ref への対応。
   * ローカルのプロジェクトは手元の ref のまま持ち、クラウドへ送る本文でだけ書き換える。
   * アプリの ProjectStore が手元の ref を持ち続けるので、ローカルを書き換えても次の保存で戻される
   */
  assets?: Record<string, string>
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
  /** 既定は navigator.onLine と window の online / offline イベント */
  connectivity?: Connectivity
}

/** 端末がネットワークにつながっているかと、その変化 */
export interface Connectivity {
  isOnline(): boolean
  /** つながり方が変わるたびに listener を呼ぶ。戻り値で解除する */
  subscribe(listener: () => void): () => void
}

/**
 * - synced: 手元の変更はすべてクラウドにある
 * - pending: 送信待ち・送信中、または送れずに諦めた変更がある
 * - offline: オフライン、またはクラウドに届かず再試行を待っている
 * - conflict: 他の端末の変更と競合し、クラウド版を別名で残した。dismissConflict まで続く
 */
export type SyncState = 'synced' | 'pending' | 'offline' | 'conflict'

export interface SyncStatus {
  state: SyncState
  /** upload-url が 413（保存上限超過）を返した。アセットは手元に残し、次の保存で送り直す */
  quotaExceeded: boolean
}

export interface CloudStorage extends StorageAdapter {
  /**
   * ローカルの id のプロジェクトの共同編集（`GET /v1/projects/:id/sync`）の WebSocket URL。
   * まだクラウドに作られていないか、未ログインなら null
   */
  syncUrl(localId: ID): Promise<string | null>
  /** 今の同期状態。変わらない間は同じオブジェクトを返す */
  getSyncStatus(): SyncStatus
  /** 同期状態が変わるたびに listener を呼ぶ。戻り値で解除する */
  subscribeSyncStatus(listener: () => void): () => void
  /** 'conflict' を利用者が確認したものとして解除する */
  dismissConflict(): void
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
/** workers/api が受けるアセットの型。他の型はアップロードせずローカルに置く */
const UPLOADABLE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
/** メモリに持つクラウドのアセットの数。1 ページ分の生成画像と履歴が収まる程度 */
const MAX_CACHED_ASSETS = 100
const R2_PREFIX = 'r2:'

/** クラウドに置いたアセットの ref。workers/api の R2 のキーと同じく `<クラウドのプロジェクト id>/<アセット id>` */
export const toCloudAssetRef = (cloudId: ID, assetId: string) => `${R2_PREFIX}${cloudId}/${assetId}`

/** `r2:<クラウドのプロジェクト id>/<アセット id>` を分解する。形式が違えば undefined */
export function parseCloudAssetRef(ref: string): { cloudId: ID; assetId: string } | undefined {
  if (!ref.startsWith(R2_PREFIX)) return undefined
  const [cloudId, assetId, ...rest] = ref.slice(R2_PREFIX.length).split('/')
  if (!cloudId || !assetId || rest.length > 0) return undefined
  return { cloudId, assetId }
}

/** プロジェクトのアセットの ref をすべて map で置き換えた複製 */
function mapAssetRefs(p: Project, map: (ref: string) => string): Project {
  return {
    ...p,
    characters: p.characters.map((c) =>
      c.referenceRef === undefined ? c : { ...c, referenceRef: map(c.referenceRef) },
    ),
    episodes: p.episodes.map((e) => ({
      ...e,
      pages: e.pages.map((page) => ({
        ...page,
        ...(page.reference && { reference: { ...page.reference, ref: map(page.reference.ref) } }),
        panels: page.panels.map((panel) => ({
          ...panel,
          arts: panel.arts.map((art) => ({ ...art, ref: map(art.ref) })),
        })),
      })),
    })),
  }
}

/**
 * アップロードする順に分けたアセットの ref。first は採用中の絵、キャラの参照画像、ページの参照画像で、
 * later は採用されていない生成履歴。履歴は件数が多いので、画面に出るものを先に送る
 */
function assetRefsByPriority(p: Project): { first: string[]; later: string[] } {
  const first = new Set<string>()
  const later = new Set<string>()
  for (const c of p.characters) if (c.referenceRef !== undefined) first.add(c.referenceRef)
  for (const e of p.episodes) {
    for (const page of e.pages) {
      if (page.reference) first.add(page.reference.ref)
      for (const panel of page.panels) {
        for (const art of panel.arts) (art.id === panel.artId ? first : later).add(art.ref)
      }
    }
  }
  return { first: [...first], later: [...later].filter((r) => !first.has(r)) }
}

function browserConnectivity(): Connectivity {
  return {
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    subscribe(listener) {
      if (typeof window === 'undefined') return () => {}
      window.addEventListener('online', listener)
      window.addEventListener('offline', listener)
      return () => {
        window.removeEventListener('online', listener)
        window.removeEventListener('offline', listener)
      }
    },
  }
}

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

/** キーの並びに依らない JSON 文字列 */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  )

/**
 * id と updatedAt 以外が同じか。PUT がサーバで保存されたのに応答だけ失われた場合、
 * クラウド版は手元と同じ内容で updatedAt だけ進んでおり、競合ではない
 */
const sameContent = (a: Project, b: Project) =>
  canonical({ ...a, id: undefined, updatedAt: undefined }) ===
  canonical({ ...b, id: undefined, updatedAt: undefined })

const isNetworkError = (e: unknown) => e instanceof TypeError

/** 時間をおけば通りうる応答 */
const isTransient = (res: Response) => res.status === 429 || res.status >= 500

/**
 * ローカル優先でクラウドに同期する StorageAdapter（docs/workstreams/WS-15-cloud-storage.md）。
 * - saveProject は local に書いて返し、クラウドへは debounceMs 後にバックグラウンドで PUT する。
 *   失敗は指数バックオフ（上限 5 分）で再試行し、オフラインなら online イベントで再開する。
 * - loadProject はクラウドの版と比べ、変更があった側を採用する。両方に変更があれば競合として扱う。
 * - PUT が 409 のときはクラウド版を「（クラウド版）」付きの別プロジェクトとしてローカルに保存して
 *   クラウドにも新規で送り、手元の版でクラウドを上書きする。どちらの版も両方に残る。
 * - putAsset は local に置いて手元の ref を返す。プロジェクトを送るときに、プロジェクトが参照する
 *   送れる画像を署名 URL でアップロードし、送る本文の ref を `r2:<クラウドのプロジェクト id>/<アセット id>`
 *   に書き換える。採用中の絵と参照画像は PUT の前に、生成履歴は PUT の後に送ってもう一度 PUT する。
 *   upload-url が 413 なら再試行せず、次の保存まで残りのアセットを送らない。
 * - `r2:` の ref はクラウドから読み、メモリに MAX_CACHED_ASSETS 件まで持つ。他の ref は local に委ねる。
 * - 同期状態は getSyncStatus と subscribeSyncStatus で読む。
 */
export function createCloudStorage(opts: CloudStorageOptions): CloudStorage {
  const { local, getToken } = opts
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  const links = opts.links ?? createDefaultLinkStore()
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const onError = opts.onError ?? ((e: unknown) => console.warn('cloud sync failed', e))
  // 呼ぶたびに globalThis.fetch を引くのは、作成後に差し替えられた fetch（msw など）も通すため
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const connectivity = opts.connectivity ?? browserConnectivity()
  const pushes = new Map<ID, PushState>()
  const assetCache = new Map<string, Blob>()
  /** 送りを諦めたプロジェクト。次に送れるまで pending として見せる */
  const failed = new Set<ID>()
  /** 手元に無い、または送れない型のアセットの ref。送り直しても変わらないので覚えておく */
  const unsendable = new Set<string>()
  let quotaExceeded = false
  let conflict = false
  let disposed = false
  let status: SyncStatus = { state: 'synced', quotaExceeded: false }
  const listeners = new Set<() => void>()

  const isOffline = () => !connectivity.isOnline()

  function notify() {
    const retrying = [...pushes.values()].some((s) => s.failures > 0)
    const state: SyncState = conflict
      ? 'conflict'
      : isOffline() || retrying
        ? 'offline'
        : pushes.size > 0 || failed.size > 0
          ? 'pending'
          : 'synced'
    if (state === status.state && quotaExceeded === status.quotaExceeded) return
    status = { state, quotaExceeded }
    for (const listener of listeners) listener()
  }

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

  /** クラウドへ送る本文。アップロード済みのアセットの ref を `r2:` に書き換える */
  const toCloud = (project: Project, link: CloudLink): Project => ({
    ...mapAssetRefs(project, (ref) => link.assets?.[ref] ?? ref),
    id: link.cloudId,
  })

  /** クラウドの版をローカルの id で保存し、同期済みとして記録する */
  async function adopt(localId: ID, cloudId: ID, remote: { project: Project; etag: string }) {
    const prev = await links.get(localId)
    const assets = prev?.cloudId === cloudId ? prev.assets : undefined
    // 手元から送ったアセットは手元の ref に戻し、クラウドから読み直さずに済ませる
    const back = new Map(Object.entries(assets ?? {}).map(([localRef, r2]) => [r2, localRef]))
    const project = { ...mapAssetRefs(remote.project, (ref) => back.get(ref) ?? ref), id: localId }
    await local.saveProject(project)
    await links.set(localId, {
      cloudId,
      etag: remote.etag,
      syncedUpdatedAt: project.updatedAt,
      ...(assets && { assets }),
    })
    return project
  }

  /** クラウド版を別名の新しいローカルプロジェクトとして残し、クラウドにも新規で送る */
  async function keepCloudCopy(remote: Project) {
    const copy = { ...remote, id: newId(), title: conflictCopyTitle(remote.title) }
    await local.saveProject(copy)
    conflict = true
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

  type UploadResult =
    | { status: 'ok'; ref: string }
    | { status: 'retry' }
    | { status: 'quota' }
    | { status: 'rejected' }

  /** 署名 URL で 1 件アップロードする。ネットワークの失敗は TypeError のまま throw する */
  async function uploadBlob(cloudId: ID, blob: Blob): Promise<UploadResult> {
    const res = await request(`/${encodeURIComponent(cloudId)}/assets/upload-url`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mime: blob.type, size: blob.size }),
    })
    if (res === null || isTransient(res)) return { status: 'retry' }
    if (res.status === 413) return { status: 'quota' }
    if (!res.ok) {
      onError(await unexpected(res, 'POST upload-url'))
      return { status: 'rejected' }
    }
    const { assetId, url } = (await res.json()) as { assetId: string; url: string }
    // 署名 URL が認可を兼ねるので Authorization は付けない
    const put = await doFetch(url, {
      method: 'PUT',
      headers: { 'content-type': blob.type },
      body: blob,
    })
    if (isTransient(put)) return { status: 'retry' }
    if (!put.ok) {
      onError(await unexpected(put, `PUT asset ${assetId}`))
      return { status: 'rejected' }
    }
    return { status: 'ok', ref: toCloudAssetRef(cloudId, assetId) }
  }

  const needsUpload = (ref: string, link: CloudLink | undefined) =>
    !parseCloudAssetRef(ref) && !unsendable.has(ref) && !link?.assets?.[ref]

  /**
   * refs のうち未アップロードのものを順に送り、1 件ごとに link に記録する。
   * 'retry' は時間をおけば送れる失敗で、それまでに送れた分は link に残る
   */
  async function uploadRefs(localId: ID, link: CloudLink, refs: string[]) {
    let uploaded = 0
    for (const ref of refs) {
      if (!needsUpload(ref, link)) continue
      let blob: Blob
      try {
        blob = await local.loadAsset(ref)
      } catch {
        // 他の端末が手元の ref のまま送ったアセットは、この端末には無い
        unsendable.add(ref)
        continue
      }
      if (!UPLOADABLE_MIME_TYPES.has(blob.type)) {
        unsendable.add(ref)
        continue
      }
      const result = await uploadBlob(link.cloudId, blob)
      if (result.status === 'retry') return { link, outcome: 'retry' as const, uploaded }
      if (result.status === 'quota') {
        quotaExceeded = true
        notify()
        break
      }
      if (result.status === 'rejected') {
        unsendable.add(ref)
        continue
      }
      quotaExceeded = false
      notify()
      cacheAsset(result.ref, blob)
      link = { ...link, assets: { ...link.assets, [ref]: result.ref } }
      await links.set(localId, link)
      uploaded++
    }
    return { link, outcome: 'ok' as const, uploaded }
  }

  /** 前回の送信で送り切れなかったアセットがあるか。上限超過のあいだは次の保存まで送らない */
  const hasUnsentAssets = (project: Project, link: CloudLink | undefined) => {
    if (quotaExceeded) return false
    const { first, later } = assetRefsByPriority(project)
    return [...first, ...later].some((r) => needsUpload(r, link))
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
    if (link?.syncedUpdatedAt === project.updatedAt && !hasUnsentAssets(project, link))
      return 'done'
    // 上限超過は今回の送信で 413 を受けたときだけ立て直す
    if (quotaExceeded) {
      quotaExceeded = false
      notify()
    }
    const refs = assetRefsByPriority(project)

    let laterSent = false
    /** PUT が通った後に履歴を送る。送れた分があればもう一度 PUT するので undefined を返す */
    const sendLater = async (): Promise<PushOutcome | undefined> => {
      if (laterSent || !link) return 'done'
      laterSent = true
      const later = await uploadRefs(localId, link, refs.later)
      link = later.link
      if (later.uploaded > 0) {
        // ref を書き換えた本文がまだ PUT されていないので、次の送信で送り直させる
        link = { ...link, syncedUpdatedAt: null }
        await links.set(localId, link)
      }
      if (later.outcome === 'retry') return 'retry'
      return later.uploaded === 0 ? 'done' : undefined
    }

    for (let attempt = 0; attempt < MAX_PUTS_PER_PUSH; attempt++) {
      if (!link) {
        const created = await createRemote(localId, project.title)
        if (created === null) return 'retry'
        link = created
      }
      // 他の端末が開いたときに表示できるよう、画面に出る画像は PUT より先に送る
      const first = await uploadRefs(localId, link, refs.first)
      link = first.link
      if (first.outcome === 'retry') return 'retry'
      const body = toCloud(project, link)
      const res = await request(`/${encodeURIComponent(link.cloudId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'if-match': `"${link.etag}"` },
        body: JSON.stringify(body),
      })
      if (res === null) return 'retry'
      if (res.ok) {
        const resBody = (await res.json()) as { updatedAt?: string }
        const etag = parseEtag(res.headers.get('etag')) ?? resBody.updatedAt
        if (!etag) throw new Error('PUT project returned no updatedAt')
        link = { ...link, etag, syncedUpdatedAt: project.updatedAt }
        await links.set(localId, link)
        const outcome = await sendLater()
        if (outcome) return outcome
        continue
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
        if (sameContent(remote.project, body)) {
          link = { ...link, etag: remote.etag, syncedUpdatedAt: project.updatedAt }
          await links.set(localId, link)
          const outcome = await sendLater()
          if (outcome) return outcome
          continue
        }
        await keepCloudCopy(remote.project)
        link = { ...link, etag: remote.etag }
        await links.set(localId, link)
        continue
      }
      if (isTransient(res)) return 'retry'
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
    notify()
  }

  function run(id: ID): Promise<void> {
    const state = stateOf(id)
    clearTimeout(state.timer)
    state.timer = undefined
    if (state.running) {
      state.again = true
      return state.running
    }
    const attempt = async (): Promise<PushOutcome> => {
      try {
        return await push(id)
      } catch (e) {
        // fetch の TypeError はオフラインや DNS の一時的な失敗なので、送れるまで再試行する
        if (!isNetworkError(e)) onError(e)
        return isNetworkError(e) ? 'retry' : 'failed'
      }
    }
    state.running = (async () => {
      // オフラインでも一度は await を挟む。同期的に最後まで進むと、下で消した state.running を
      // この関数を囲む代入が後から上書きし、送信中のまま残る
      const outcome = await (isOffline() ? 'retry' : attempt())
      state.running = undefined
      if (outcome === 'retry') {
        state.failures++
        state.again = false
        if (disposed) return
        const delay = Math.min(FIRST_RETRY_MS * 2 ** (state.failures - 1), MAX_RETRY_MS)
        state.timer = setTimeout(() => void run(id), delay)
        notify()
        return
      }
      state.failures = 0
      if (outcome === 'failed') failed.add(id)
      else failed.delete(id)
      if (state.again) {
        state.again = false
        schedule(id, debounceMs)
      } else {
        pushes.delete(id)
      }
      notify()
    })()
    return state.running
  }

  const isPending = (id: ID) => pushes.has(id)

  const unsubscribeConnectivity = connectivity.subscribe(() => {
    if (!isOffline()) {
      for (const [id, state] of pushes) {
        if (state.timer !== undefined && state.failures > 0) void run(id)
      }
    }
    notify()
  })

  function cacheAsset(ref: string, blob: Blob) {
    assetCache.delete(ref)
    assetCache.set(ref, blob)
    // Map は挿入順を保つので、先頭が最も長く使われていない
    for (const oldest of assetCache.keys()) {
      if (assetCache.size <= MAX_CACHED_ASSETS) break
      assetCache.delete(oldest)
    }
  }

  async function loadCloudAsset(ref: string, cloudId: ID, assetId: string): Promise<Blob> {
    const cached = assetCache.get(ref)
    if (cached) {
      cacheAsset(ref, cached)
      return cached
    }
    const res = await request(
      `/${encodeURIComponent(cloudId)}/assets/${encodeURIComponent(assetId)}`,
    )
    if (res === null) throw new Error(`Asset ${ref} needs a token`)
    if (res.status === 404) throw new Error(`Asset not found: ${ref}`)
    if (!res.ok) throw await unexpected(res, `GET asset ${ref}`)
    const blob = await res.blob()
    cacheAsset(ref, blob)
    return blob
  }

  const loadAsset = (ref: string) => {
    const cloud = parseCloudAssetRef(ref)
    return cloud ? loadCloudAsset(ref, cloud.cloudId, cloud.assetId) : local.loadAsset(ref)
  }

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
    if (cloudChanged && sameContent(remote.project, toCloud(localProject, link))) {
      await links.set(id, { ...link, etag: remote.etag, syncedUpdatedAt: localProject.updatedAt })
      return localProject
    }
    if (cloudChanged) {
      await keepCloudCopy(remote.project)
      await links.set(id, { ...link, etag: remote.etag })
    }
    if (localChanged || hasUnsentAssets(localProject, link)) schedule(id, debounceMs)
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
      // リンクもローカルの版も無い id は、listProjects が並べたクラウドだけのプロジェクトの id
      const guessed = !link && !(await local.loadProject(id).catch(() => undefined))
      const cloudId = link?.cloudId ?? (guessed ? id : undefined)
      if (cloudId !== undefined) {
        // クラウドへの DELETE が済む前にローカルだけ消すと、未ログインや失敗のあとで一覧にクラウド側が戻ってくる
        // ただし推測した id は存在しないかもしれないので、送れなかったときは契約どおり何もせず終える
        try {
          const res = await request(`/${encodeURIComponent(cloudId)}`, { method: 'DELETE' })
          if (res === null) {
            if (guessed) return
            throw new Error(`DELETE project ${cloudId} needs a token`)
          }
          if (!res.ok && res.status !== 404) {
            throw await unexpected(res, `DELETE project ${cloudId}`)
          }
        } catch (e) {
          if (guessed) return
          throw e
        }
      }
      await local.deleteProject(id)
      await links.delete(id)
      failed.delete(id)
      notify()
      if (cloudId !== undefined) {
        for (const ref of assetCache.keys()) {
          if (parseCloudAssetRef(ref)?.cloudId === cloudId) assetCache.delete(ref)
        }
      }
    },
    async resolveAsset(ref) {
      if (!parseCloudAssetRef(ref)) return local.resolveAsset(ref)
      return URL.createObjectURL(await loadAsset(ref))
    },
    loadAsset,
    putAsset: (projectId, blob, hint) => local.putAsset(projectId, blob, hint),
    getSyncStatus: () => status,
    subscribeSyncStatus(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dismissConflict() {
      conflict = false
      notify()
    },
    async syncUrl(localId) {
      const link = await links.get(localId)
      if (!link || (await getToken()) === null) return null
      const url = new URL(`${baseUrl}/v1/projects/${encodeURIComponent(link.cloudId)}/sync`)
      url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
      return url.toString()
    },
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
      unsubscribeConnectivity()
      listeners.clear()
    },
  }
}

if (import.meta.vitest) {
  const { http, HttpResponse } = await import('msw')
  const { setupServer } = await import('msw/node')
  const { createEmptyProject, createPage } = await import('@manga/schema')
  const { summarize } = await import('./adapter')
  const { createMemoryStorage } = await import('./memory')
  const { afterAll, afterEach, beforeAll, describe, expect, test, vi } = import.meta.vitest

  const BASE = 'https://api.test'
  const TOKEN = 'token'

  /** workers/api の /v1/projects を真似る。updated_at はサーバの時計で進み、PUT は If-Match が違うと 409 */
  const createFakeApi = () => {
    const rows = new Map<ID, Project>()
    const assets = new Map<string, Blob>()
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
      http.post(`${BASE}/v1/projects/:id/assets/upload-url`, async ({ request, params }) => {
        if (!accept(request)) return unauthorized()
        if (!rows.has(String(params.id))) return notFound()
        const { mime } = (await request.json()) as { mime: string }
        const assetId = crypto.randomUUID()
        return HttpResponse.json({
          assetId,
          url: `${BASE}/v1/uploads/${params.id}/${assetId}?mime=${encodeURIComponent(mime)}&sig=s`,
        })
      }),
      http.put(`${BASE}/v1/uploads/:id/:assetId`, async ({ request, params }) => {
        requests.push(`${request.method} ${new URL(request.url).pathname}`)
        if (request.headers.has('authorization')) return unauthorized()
        assets.set(`${params.id}/${params.assetId}`, await request.blob())
        return HttpResponse.json({ assetId: params.assetId }, { status: 201 })
      }),
      http.get(`${BASE}/v1/projects/:id/assets/:assetId`, ({ request, params }) => {
        if (!accept(request)) return unauthorized()
        const blob = assets.get(`${params.id}/${params.assetId}`)
        return blob
          ? new HttpResponse(blob, { headers: { 'content-type': blob.type } })
          : notFound()
      }),
    ]
    return { rows, assets, requests, handlers }
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

    test('edits made offline are sent when the device comes back online', async () => {
      const api = useApi()
      let online = false
      const listeners = new Set<() => void>()
      const { storage, links, errors } = createDevice({
        connectivity: {
          isOnline: () => online,
          subscribe(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        },
      })
      const p = createEmptyProject('A')
      await storage.saveProject(p)
      await storage.saveProject(edit(p, 'offline edit'))
      await storage.flush()
      expect(api.requests).toEqual([])
      expect(storage.getSyncStatus().state).toBe('offline')

      online = true
      for (const listener of listeners) listener()
      await vi.waitFor(async () =>
        expect((await links.get(p.id))?.syncedUpdatedAt).toBe(edit(p, '').updatedAt),
      )
      expect(api.rows.get(await cloudIdOf(links, p.id))?.title).toBe('offline edit')
      expect(storage.getSyncStatus().state).toBe('synced')
      expect(errors).toEqual([])
    })

    test('the sync status goes pending, synced, and conflict until dismissed', async () => {
      useApi()
      const a = createDevice()
      const seen: SyncState[] = []
      a.storage.subscribeSyncStatus(() => seen.push(a.storage.getSyncStatus().state))
      expect(a.storage.getSyncStatus().state).toBe('synced')
      const p = createEmptyProject('A')
      await a.storage.saveProject(p)
      expect(a.storage.getSyncStatus().state).toBe('pending')
      await a.storage.flush()
      expect(seen).toEqual(['pending', 'synced'])

      const b = createDevice()
      const loaded = await b.storage.loadProject(await cloudIdOf(a.links, p.id))
      await b.storage.saveProject(edit(loaded, 'from B'))
      await b.storage.flush()
      await a.storage.saveProject(edit(p, 'from A'))
      await a.storage.flush()
      expect(a.storage.getSyncStatus().state).toBe('conflict')
      a.storage.dismissConflict()
      expect(a.storage.getSyncStatus().state).toBe('synced')
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

  describe('createCloudStorage assets', () => {
    const png = (byte = 0) =>
      new Blob([new Uint8Array([137, 80, 78, 71, byte])], { type: 'image/png' })
    const bytes = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())]

    /** 1 コマに arts を並べ、最後の 1 枚を採用中にする */
    const withArts = (p: Project, refs: string[]): Project => {
      const page = createPage('2rows', 'rtl')
      const panel = page.panels[0]
      if (!panel) throw new Error('no panel')
      panel.arts = refs.map((ref, i) => ({
        id: `art${i}`,
        ref,
        provider: 'fake',
        prompt: 'p',
        createdAt: p.createdAt,
      }))
      panel.artId = `art${refs.length - 1}`
      return { ...p, episodes: [{ id: 'ep', title: 'ep', pages: [page] }] }
    }
    const artRefs = (p: Project | undefined) =>
      p?.episodes[0]?.pages[0]?.panels[0]?.arts.map((a) => a.ref) ?? []

    const synced = async () => {
      const api = useApi()
      const a = createDevice()
      const p = createEmptyProject('A')
      await a.storage.saveProject(p)
      await a.storage.flush()
      return { api, a, p, cloudId: await cloudIdOf(a.links, p.id) }
    }

    test('putAsset stores locally and the next push uploads it and rewrites the ref', async () => {
      const { api, a, p, cloudId } = await synced()
      const ref = await a.storage.putAsset(p.id, png(), 'panel')
      expect(ref).toMatch(/^blob:/)
      expect(api.assets.size).toBe(0)

      const edited = withArts(edit(p, 'A'), [ref])
      await a.storage.saveProject(edited)
      await a.storage.flush()
      const [cloudRef] = artRefs(api.rows.get(cloudId))
      expect(parseCloudAssetRef(cloudRef ?? '')).toEqual({ cloudId, assetId: expect.any(String) })
      expect(artRefs(await a.local.loadProject(p.id))).toEqual([ref])
      expect(a.errors).toEqual([])

      const b = createDevice()
      const loaded = await b.storage.loadProject(cloudId)
      const [loadedRef] = artRefs(loaded)
      expect(await bytes(await b.storage.loadAsset(loadedRef ?? ''))).toEqual([137, 80, 78, 71, 0])
      const url = await b.storage.resolveAsset(loadedRef ?? '')
      expect(url).toMatch(/^blob:/)
      URL.revokeObjectURL(url)
    })

    test('the adopted art is uploaded before the project, history after it', async () => {
      const { api, a, p, cloudId } = await synced()
      const history = [
        await a.storage.putAsset(p.id, png(1)),
        await a.storage.putAsset(p.id, png(2)),
      ]
      const adopted = await a.storage.putAsset(p.id, png(3))
      await a.storage.saveProject(withArts(edit(p, 'A'), [...history, adopted]))
      const before = api.requests.length
      await a.storage.flush()

      const cloudRefs = artRefs(api.rows.get(cloudId))
      expect(cloudRefs.every((r) => parseCloudAssetRef(r))).toBe(true)
      const uploadIndex = (r: string | undefined) =>
        api.requests.findIndex((q) => q === `PUT /v1/uploads/${r?.slice('r2:'.length)}`)
      const sent = api.requests.slice(before)
      expect(sent.filter((q) => q === `PUT /v1/projects/${cloudId}`)).toHaveLength(2)
      const firstPut = api.requests.indexOf(`PUT /v1/projects/${cloudId}`, before)
      expect(uploadIndex(cloudRefs[2])).toBeLessThan(firstPut)
      expect(uploadIndex(cloudRefs[0])).toBeGreaterThan(firstPut)
      expect(uploadIndex(cloudRefs[1])).toBeGreaterThan(firstPut)
      expect(a.storage.getSyncStatus()).toEqual({ state: 'synced', quotaExceeded: false })
    })

    test('a project adopted back from the cloud keeps the local refs', async () => {
      const { a, p, cloudId } = await synced()
      const ref = await a.storage.putAsset(p.id, png())
      const edited = withArts(edit(p, 'A'), [ref])
      await a.storage.saveProject(edited)
      await a.storage.flush()

      const b = createDevice()
      const loaded = await b.storage.loadProject(cloudId)
      await b.storage.saveProject(edit(loaded, 'from B'))
      await b.storage.flush()

      const reloaded = await a.storage.loadProject(p.id)
      expect(reloaded.title).toBe('from B')
      expect(artRefs(reloaded)).toEqual([ref])
    })

    test('a loaded cloud asset is served from memory afterwards', async () => {
      const { api, a, p, cloudId } = await synced()
      await a.storage.saveProject(withArts(edit(p, 'A'), [await a.storage.putAsset(p.id, png())]))
      await a.storage.flush()
      const [ref] = artRefs(api.rows.get(cloudId))
      const b = createDevice()
      await b.storage.loadAsset(ref ?? '')
      const before = api.requests.length
      await b.storage.loadAsset(ref ?? '')
      expect(api.requests).toHaveLength(before)
    })

    test('assets that cannot be sent stay local, and failed uploads are retried', async () => {
      const { api, a, p, cloudId } = await synced()
      const svg = await a.storage.putAsset(p.id, new Blob(['<svg/>'], { type: 'image/svg+xml' }))
      const image = await a.storage.putAsset(p.id, png())
      server.use(
        http.post(`${BASE}/v1/projects/:id/assets/upload-url`, () => HttpResponse.error(), {
          once: true,
        }),
      )
      await a.storage.saveProject(withArts(edit(p, 'A'), [svg, image]))
      await a.storage.flush()
      expect(api.assets.size).toBe(0)
      expect(a.storage.getSyncStatus().state).toBe('offline')

      await vi.waitFor(() => expect(api.assets.size).toBe(1), { timeout: 3000 })
      await vi.waitFor(() => {
        const [first, second] = artRefs(api.rows.get(cloudId))
        expect(first).toBe(svg)
        expect(parseCloudAssetRef(second ?? '')).toBeDefined()
      })
      expect(a.errors).toEqual([])
    })

    test('a 413 from upload-url keeps the asset local without retrying', async () => {
      const { api, a, p, cloudId } = await synced()
      let full = true
      server.use(
        http.post(`${BASE}/v1/projects/:id/assets/upload-url`, () =>
          full ? HttpResponse.json({ error: 'quota' }, { status: 413 }) : undefined,
        ),
      )
      const ref = await a.storage.putAsset(p.id, png())
      await a.storage.saveProject(withArts(edit(p, 'A'), [ref]))
      await a.storage.flush()
      expect(artRefs(api.rows.get(cloudId))).toEqual([ref])
      expect(a.storage.getSyncStatus()).toEqual({ state: 'synced', quotaExceeded: true })
      expect(await bytes(await a.local.loadAsset(ref))).toEqual([137, 80, 78, 71, 0])

      full = false
      const before = api.requests.length
      await a.storage.flush()
      expect(api.requests).toHaveLength(before)

      await a.storage.saveProject(withArts(edit(edit(p, 'A'), 'B'), [ref]))
      await a.storage.flush()
      expect(parseCloudAssetRef(artRefs(api.rows.get(cloudId))[0] ?? '')).toBeDefined()
      expect(a.storage.getSyncStatus().quotaExceeded).toBe(false)
    })

    test('loading a missing cloud asset rejects', async () => {
      const { a, cloudId } = await synced()
      await expect(a.storage.loadAsset(toCloudAssetRef(cloudId, 'nope'))).rejects.toThrow(
        /not found/,
      )
    })

    test('parseCloudAssetRef accepts only r2:<project>/<asset>', () => {
      expect(parseCloudAssetRef(toCloudAssetRef('p', 'a'))).toEqual({ cloudId: 'p', assetId: 'a' })
      for (const ref of ['blob:x', 'r2:', 'r2:p', 'r2:p/', 'r2:/a', 'r2:p/a/b']) {
        expect(parseCloudAssetRef(ref)).toBeUndefined()
      }
    })
  })

  describe('createCloudStorage syncUrl', () => {
    test('points at the sync route of the cloud project over WebSocket', async () => {
      useApi()
      const { storage, links } = createDevice()
      const p = createEmptyProject('A')
      await storage.saveProject(p)
      expect(await storage.syncUrl(p.id)).toBeNull()
      await storage.flush()
      const cloudId = await cloudIdOf(links, p.id)
      expect(await storage.syncUrl(p.id)).toBe(`wss://api.test/v1/projects/${cloudId}/sync`)
    })

    test('is null while signed out', async () => {
      useApi()
      const links = createMemoryLinkStore()
      await links.set('p', { cloudId: 'c', etag: 'e', syncedUpdatedAt: null })
      const { storage } = createDevice({ links, getToken: async () => null })
      expect(await storage.syncUrl('p')).toBeNull()
    })
  })
}
