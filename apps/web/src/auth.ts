import { m } from '@manga/i18n'
import { readApiError } from '@manga/schema'

/** ログイン中のユーザー。Better Auth の user の画面で使う分だけ */
export interface AuthUser {
  id: string
  /** 表示名。Google の名前は保存しないので、登録してから決めるまでは空 */
  name: string
  email: string
  image: string | null
}

export interface AuthClient {
  /** ログイン中のユーザー。未ログインとローカルモードへの降格後は null */
  getUser(): AuthUser | null
  /** ユーザーが変わるたびに呼ぶ。戻り値で購読をやめる */
  subscribe(listener: () => void): () => void
  /** API の Cookie のセッションからトークンを取り直す。起動時と Google からの戻りで呼ぶ */
  restore(): Promise<void>
  /**
   * Google のログイン画面へ移る。戻ってくると今の URL に着く。
   * まだ登録していないユーザーは、招待リンクのトークンを `inviteToken` に渡したときだけ登録される
   */
  signIn(opts?: { inviteToken?: string }): Promise<void>
  /** `openExternal` で始めたログインの、deep link で戻った一度きりのトークンをセッションに換える。換えられなければ throw */
  completeSignIn(oneTimeToken: string): Promise<void>
  /** 表示名を変える。未ログインか、API が名前を受け付けなければ throw */
  setName(name: string): Promise<void>
  /** サーバのセッションを消し、手元のトークンとユーザーを捨てる */
  signOut(): Promise<void>
  /** 期限が近ければ取り直した Bearer トークン。未ログインか取り直せなければ null */
  getToken(): Promise<string | null>
  /** Bearer を付けて送り、401 ならトークンを取り直して 1 度だけ送り直す fetch */
  fetch: typeof fetch
}

/** 再起動をまたいでトークンを持つ先 */
export interface TokenStore {
  load(): Promise<string | null>
  /** null で消す */
  save(token: string | null): Promise<void>
}

export interface AuthClientOptions {
  /** workers/api のオリジン。空なら API が無いものとして常に未ログイン */
  baseUrl: string
  fetch?: typeof fetch
  now?: () => number
  /** signIn の遷移先を開く。既定は location.assign */
  navigate?: (url: string) => void
  /** Desktop で渡す。Web は API の Cookie から取り直せるので渡さない */
  tokenStore?: TokenStore
  /**
   * Desktop で渡す。signIn は API の `/v1/desktop-sign-in` をこれで OS のブラウザに開き、戻りは completeSignIn で受ける。
   * Google は WebView の中での OAuth を断るため
   */
  openExternal?: (url: string) => Promise<void>
}

interface Session {
  token: string
  expiresAt: number
  user: AuthUser
}

/** 期限のこれだけ前から取り直す。要求の途中で切れて 401 になるのを避けるため */
const REFRESH_MARGIN_MS = 60_000

/**
 * workers/api の Better Auth（Google OAuth と bearer プラグイン）につなぐクライアント。
 * トークンはメモリに持ち、リロード後は API の Cookie のセッションから `restore()` で取り直す。
 * `tokenStore` があればトークンをそこにも書き、`restore()` はそのトークンを Bearer に付けて取り直す。
 * 取り直しが認証で失敗したら未ログインに戻し、呼び出し側はローカルモードで動き続ける。
 */
export function createAuthClient(opts: AuthClientOptions): AuthClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  // 呼ぶたびに globalThis.fetch を引くのは、作成後に差し替えられた fetch（msw など）も通すため
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const now = opts.now ?? Date.now
  const navigate = opts.navigate ?? ((url: string) => window.location.assign(url))
  const listeners = new Set<() => void>()
  let session: Session | null = null
  let refreshing: Promise<string | null> | null = null
  /** tokenStore に書いてあるトークン。undefined はまだ読んでいない */
  let saved: string | null | undefined

  const persist = (token: string | null) => {
    if (!opts.tokenStore || token === saved) return
    saved = token
    // 書けなくても今のセッションは続ける。次の起動でログインし直すだけになる
    void opts.tokenStore.save(token).catch(() => {})
  }

  const setSession = (next: Session | null) => {
    persist(next?.token ?? null)
    if (session === next) return
    session = next
    for (const listener of listeners) listener()
  }

  const authFetch = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    const bearer = session?.token ?? saved
    if (bearer) headers.set('authorization', `Bearer ${bearer}`)
    // Google から戻った直後は Cookie しか無いので、Bearer と一緒に Cookie も送る
    return doFetch(`${baseUrl}/v1/auth${path}`, { ...init, headers, credentials: 'include' })
  }

  /** get-session でトークンを取り直す。認証の失敗は未ログインに戻し、通信の失敗は状態を変えずに null */
  async function refresh(): Promise<string | null> {
    if (baseUrl === '') return null
    if (opts.tokenStore && saved === undefined) {
      saved = await opts.tokenStore.load().catch(() => null)
    }
    let res: Response
    try {
      res = await authFetch('/get-session')
    } catch {
      return null
    }
    if (!res.ok) {
      if (res.status === 401) setSession(null)
      return null
    }
    const body = (await res.json().catch(() => null)) as GetSessionBody | null
    if (!body?.session || !body.user) {
      setSession(null)
      return null
    }
    // 期限を延ばしたときは bearer プラグインが新しいトークンを set-auth-token で返す
    const token = res.headers.get('set-auth-token') ?? body.session.token
    setSession(toSession(body.session, body.user, token))
    return token
  }

  /** 同時に呼ばれても get-session は 1 本にまとめる */
  const refreshOnce = () => {
    refreshing ??= refresh().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  async function getToken(): Promise<string | null> {
    if (session === null) return refreshing ?? null
    if (session.expiresAt - now() > REFRESH_MARGIN_MS) return session.token
    return refreshOnce()
  }

  const withToken = (init: RequestInit | undefined, token: string) => {
    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${token}`)
    return { ...init, headers }
  }

  const fetchWithAuth: typeof fetch = async (input, init) => {
    const token = await getToken()
    if (token === null) return doFetch(input, init)
    const res = await doFetch(input, withToken(init, token))
    if (res.status !== 401) return res
    const next = await refreshOnce()
    if (next === null || next === token) return res
    return doFetch(input, withToken(init, next))
  }

  return {
    getUser: () => session?.user ?? null,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async restore() {
      await refreshOnce()
    },
    async signIn({ inviteToken } = {}) {
      if (baseUrl === '') throw new Error(m.web_auth_api_url_missing())
      if (opts.openExternal) {
        const url = new URL(`${baseUrl}/v1/desktop-sign-in`)
        if (inviteToken !== undefined) url.searchParams.set('invite', inviteToken)
        await opts.openExternal(url.toString())
        return
      }
      const res = await authFetch('/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 失敗しても今の画面へ戻し、takeSignInError で理由を出す。省くと API の既定のエラーページに着く
        body: JSON.stringify({
          provider: 'google',
          callbackURL: window.location.href,
          errorCallbackURL: window.location.href,
          ...(inviteToken !== undefined && { additionalData: { inviteToken } }),
        }),
      })
      if (!res.ok) throw await readApiError(res, 'POST sign-in')
      const { url } = (await res.json()) as { url?: string }
      if (!url) throw new Error('sign-in failed: no redirect URL')
      navigate(url)
    },
    async completeSignIn(oneTimeToken) {
      const res = await doFetch(`${baseUrl}/v1/auth/one-time-token/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: oneTimeToken }),
      })
      if (!res.ok) throw new Error(m.web_auth_sign_in_expired())
      const body = (await res.json()) as Required<GetSessionBody>
      setSession(toSession(body.session, body.user, body.session.token))
    },
    async setName(name) {
      if (session === null) throw new Error(m.web_auth_not_signed_in())
      const res = await fetchWithAuth(`${baseUrl}/v1/me`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw await readApiError(res, 'PUT me')
      const body = (await res.json()) as { name: string }
      if (session) setSession({ ...session, user: { ...session.user, name: body.name } })
    },
    async signOut() {
      try {
        if (baseUrl !== '' && (session || saved)) await authFetch('/sign-out', { method: 'POST' })
      } catch {
        // サーバに届かなくても手元のトークンは捨てる。サーバのセッションは期限で切れる
      } finally {
        setSession(null)
      }
    },
    getToken,
    fetch: fetchWithAuth,
  }
}

/** workers/api の validateSignUp が返す値 */
type SignInErrorCode = 'invite_required' | 'invite_email_mismatch'

const SIGN_IN_ERRORS: Record<SignInErrorCode, () => string> = {
  invite_required: () => m.web_sign_in_error_invite_required(),
  invite_email_mismatch: () => m.web_sign_in_error_invite_email_mismatch(),
}

const isSignInErrorCode = (code: string): code is SignInErrorCode =>
  Object.hasOwn(SIGN_IN_ERRORS, code)

/**
 * Google からの戻りでログインできなかったとき Better Auth が戻り先に付ける `?error=` を読み、
 * 画面向けの文言と、`error` と `error_description` を外した URL を返す。付いていなければ null
 */
export function takeSignInError(url: URL): { message: string; url: URL } | null {
  const code = url.searchParams.get('error')
  if (code === null) return null
  const rest = new URL(url)
  rest.searchParams.delete('error')
  rest.searchParams.delete('error_description')
  const message = isSignInErrorCode(code)
    ? SIGN_IN_ERRORS[code]()
    : m.web_sign_in_error_unknown({ code })
  return { message, url: rest }
}

interface GetSessionBody {
  session?: SessionBody
  user?: UserBody
}

interface SessionBody {
  token: string
  expiresAt: string
}

interface UserBody {
  id: string
  name: string
  email: string
  image?: string | null
}

const toSession = (session: SessionBody, user: UserBody, token: string): Session => ({
  token,
  expiresAt: Date.parse(session.expiresAt),
  user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
})

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const HOUR = 3_600_000
  const user = { id: 'u1', name: 'A', email: 'a@example.com', image: null }

  const sessionResponse = (token: string, expiresAt: number, headers: HeadersInit = {}) =>
    new Response(
      JSON.stringify({
        session: { token, expiresAt: new Date(expiresAt).toISOString() },
        user: { id: user.id, name: user.name, email: user.email },
      }),
      { headers },
    )

  type Respond = (url: string, init: RequestInit) => Response | Promise<Response>

  const setup = (respond: Respond, overrides: Partial<AuthClientOptions> = {}) => {
    let time = 0
    const fetch = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) =>
      Promise.resolve().then(() => respond(String(input), init)),
    )
    const client = createAuthClient({
      baseUrl: 'https://api.test/',
      fetch: fetch as typeof globalThis.fetch,
      now: () => time,
      ...overrides,
    })
    const bearers = () =>
      fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('authorization'))
    return {
      client,
      fetch,
      bearers,
      advance: (ms: number) => {
        time += ms
      },
    }
  }

  const memoryTokenStore = (token: string | null = null) => {
    const store = {
      token,
      save: vi.fn(async (t: string | null) => {
        store.token = t
      }),
    }
    return {
      store,
      tokenStore: { load: async () => store.token, save: store.save } satisfies TokenStore,
    }
  }

  describe('createAuthClient', () => {
    test('without an API it stays signed out and never calls fetch', async () => {
      const { client, fetch } = setup(() => new Response(), { baseUrl: '' })
      await client.restore()
      expect(client.getUser()).toBeNull()
      expect(await client.getToken()).toBeNull()
      await expect(client.signIn()).rejects.toThrow(m.web_auth_api_url_missing())
      await client.signOut()
      expect(fetch).not.toHaveBeenCalled()
    })

    test('restore takes the session from the cookie and tells subscribers', async () => {
      const { client, fetch } = setup(() => sessionResponse('t1', HOUR))
      const listener = vi.fn()
      client.subscribe(listener)
      await client.restore()
      expect(client.getUser()).toEqual(user)
      expect(await client.getToken()).toBe('t1')
      expect(listener).toHaveBeenCalledOnce()
      expect(fetch).toHaveBeenCalledWith(
        'https://api.test/v1/auth/get-session',
        expect.objectContaining({ credentials: 'include' }),
      )
    })

    test('a token in set-auth-token wins over the one in the body', async () => {
      const { client } = setup(() => sessionResponse('old', HOUR, { 'set-auth-token': 'new' }))
      await client.restore()
      expect(await client.getToken()).toBe('new')
    })

    test('an empty session or a 401 signs out, a network failure keeps the session', async () => {
      let respond: Respond = () => sessionResponse('t1', HOUR)
      const { client, advance } = setup((url, init) => respond(url, init))
      await client.restore()

      respond = () => {
        throw new TypeError('network')
      }
      await client.restore()
      expect(client.getUser()).toEqual(user)

      respond = () => new Response('null')
      await client.restore()
      expect(client.getUser()).toBeNull()

      respond = () => sessionResponse('t2', HOUR)
      await client.restore()
      respond = () => new Response(null, { status: 401 })
      advance(HOUR)
      expect(await client.getToken()).toBeNull()
      expect(client.getUser()).toBeNull()
    })

    test('getToken refreshes only near the expiry, with one get-session for concurrent callers', async () => {
      let token = 't1'
      const { client, fetch, advance } = setup(() => sessionResponse(token, HOUR))
      await client.restore()
      advance(HOUR - 60_001)
      expect(await client.getToken()).toBe('t1')
      expect(fetch).toHaveBeenCalledOnce()

      token = 't2'
      advance(1)
      const tokens = await Promise.all([client.getToken(), client.getToken()])
      expect(tokens).toEqual(['t2', 't2'])
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    test('getToken waits for a restore in flight', async () => {
      const { client } = setup(() => sessionResponse('t1', HOUR))
      const restoring = client.restore()
      expect(await client.getToken()).toBe('t1')
      await restoring
    })

    test('fetch adds the bearer and retries once with a refreshed token after a 401', async () => {
      let token = 't1'
      const { client, bearers } = setup((url, init) => {
        if (url.endsWith('/get-session')) return sessionResponse(token, HOUR)
        const ok = new Headers(init.headers).get('authorization') === 'Bearer t2'
        return new Response(null, { status: ok ? 200 : 401 })
      })
      await client.restore()
      token = 't2'
      const res = await client.fetch('https://api.test/v1/projects', {
        headers: { accept: 'application/json' },
      })
      expect(res.status).toBe(200)
      expect(bearers()).toEqual([null, 'Bearer t1', 'Bearer t1', 'Bearer t2'])
    })

    test('fetch gives back the 401 when the refresh brings no new token', async () => {
      const { client, fetch } = setup((url) =>
        url.endsWith('/get-session')
          ? sessionResponse('t1', HOUR)
          : new Response(null, { status: 401 }),
      )
      await client.restore()
      expect((await client.fetch('https://api.test/v1/projects')).status).toBe(401)
      expect(fetch).toHaveBeenCalledTimes(3)
    })

    test('fetch without a session sends the request as it is', async () => {
      const { client, bearers } = setup(() => new Response(null, { status: 200 }))
      await client.fetch('https://api.test/v1/projects')
      expect(bearers()).toEqual([null])
    })

    test('signIn asks for Google and goes to the returned URL', async () => {
      vi.stubGlobal('window', { location: { href: 'https://app.test/p/1' } })
      const navigate = vi.fn()
      const { client, fetch } = setup(
        () => new Response(JSON.stringify({ url: 'https://accounts.test/o' })),
        { navigate },
      )
      await client.signIn()
      expect(navigate).toHaveBeenCalledExactlyOnceWith('https://accounts.test/o')
      const [url, init] = fetch.mock.calls[0] ?? []
      expect(url).toBe('https://api.test/v1/auth/sign-in/social')
      expect(JSON.parse(String(init?.body))).toEqual({
        provider: 'google',
        callbackURL: 'https://app.test/p/1',
        errorCallbackURL: 'https://app.test/p/1',
      })
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    })

    test('signIn with openExternal opens the desktop sign-in with the invite token', async () => {
      const openExternal = vi.fn(async () => {})
      const { client, fetch } = setup(() => new Response(), { openExternal })
      await client.signIn({ inviteToken: 'a/b' })
      expect(openExternal).toHaveBeenCalledExactlyOnceWith(
        'https://api.test/v1/desktop-sign-in?invite=a%2Fb',
      )
      await client.signIn()
      expect(openExternal).toHaveBeenLastCalledWith('https://api.test/v1/desktop-sign-in')
      expect(fetch).not.toHaveBeenCalled()
    })

    test('completeSignIn turns the one-time token into the session and stores it', async () => {
      const { store, tokenStore } = memoryTokenStore()
      const { client, fetch } = setup(() => sessionResponse('t1', HOUR), { tokenStore })
      const listener = vi.fn()
      client.subscribe(listener)
      await client.completeSignIn('ott')
      expect(client.getUser()).toEqual(user)
      expect(await client.getToken()).toBe('t1')
      expect(store.token).toBe('t1')
      expect(listener).toHaveBeenCalledOnce()
      const [url, init] = fetch.mock.calls[0] ?? []
      expect(url).toBe('https://api.test/v1/auth/one-time-token/verify')
      expect(JSON.parse(String(init?.body))).toEqual({ token: 'ott' })
    })

    test('completeSignIn fails on a used or expired token and stays signed out', async () => {
      const { client } = setup(() => new Response(null, { status: 400 }))
      await expect(client.completeSignIn('ott')).rejects.toThrow(m.web_auth_sign_in_expired())
      expect(client.getUser()).toBeNull()
    })

    test('takeSignInError explains the error and drops it from the URL', () => {
      expect(takeSignInError(new URL('https://app.test/p/1?settings=1'))).toBeNull()
      const refused = takeSignInError(new URL('https://app.test/invite/t?error=invite_required'))
      expect(refused?.message).toBe(m.web_sign_in_error_invite_required())
      expect(refused?.url.href).toBe('https://app.test/invite/t')
      const other = takeSignInError(
        new URL('https://app.test/?settings=1&error=access_denied&error_description=x'),
      )
      expect(other?.message).toBe(m.web_sign_in_error_unknown({ code: 'access_denied' }))
      expect(other?.url.href).toBe('https://app.test/?settings=1')
    })

    test('signIn passes the invite token through the OAuth state', async () => {
      vi.stubGlobal('window', { location: { href: 'https://app.test/invite/t1' } })
      const { client, fetch } = setup(
        () => new Response(JSON.stringify({ url: 'https://accounts.test/o' })),
        { navigate: vi.fn() },
      )
      await client.signIn({ inviteToken: 't1' })
      const [, init] = fetch.mock.calls[0] ?? []
      expect(JSON.parse(String(init?.body))).toMatchObject({
        additionalData: { inviteToken: 't1' },
      })
    })

    test('signIn fails on an error status or a missing URL', async () => {
      vi.stubGlobal('window', { location: { href: 'https://app.test/' } })
      const navigate = vi.fn()
      const failing = setup(() => new Response(null, { status: 500 }), { navigate })
      await expect(failing.client.signIn()).rejects.toThrow('POST sign-in: 500')
      const empty = setup(() => new Response('{}'), { navigate })
      await expect(empty.client.signIn()).rejects.toThrow('no redirect URL')
      expect(navigate).not.toHaveBeenCalled()
    })

    test('setName sends the name and updates the user on success only', async () => {
      let status = 200
      const { client, fetch } = setup((url, init) => {
        if (url.endsWith('/get-session')) return sessionResponse('t1', HOUR)
        if (status !== 200)
          return new Response(JSON.stringify({ code: 'invalid_request' }), { status })
        const { name } = JSON.parse(String(init.body)) as { name: string }
        return new Response(JSON.stringify({ name: name.trim() }))
      })
      await expect(client.setName('A')).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()

      await client.restore()
      const listener = vi.fn()
      client.subscribe(listener)
      await client.setName(' ペンネーム ')
      expect(client.getUser()?.name).toBe('ペンネーム')
      expect(listener).toHaveBeenCalledOnce()
      const [url, init] = fetch.mock.calls.at(-1) ?? []
      expect(url).toBe('https://api.test/v1/me')
      expect(init?.method).toBe('PUT')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t1')

      status = 400
      await expect(client.setName('')).rejects.toThrow()
      expect(client.getUser()?.name).toBe('ペンネーム')
    })

    test('signOut drops the session even when the server cannot be reached', async () => {
      let reachable = true
      const { client, fetch } = setup((url) => {
        if (url.endsWith('/get-session')) return sessionResponse('t1', HOUR)
        if (!reachable) throw new TypeError('network')
        return new Response(null)
      })
      await client.restore()
      reachable = false
      await client.signOut()
      expect(client.getUser()).toBeNull()
      expect(await client.getToken()).toBeNull()
      expect(fetch.mock.calls.at(-1)?.[0]).toBe('https://api.test/v1/auth/sign-out')

      await client.signOut()
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    test('with a tokenStore, restore sends the saved token and keeps the new one', async () => {
      const { store, tokenStore } = memoryTokenStore('saved')
      const { client, bearers } = setup(
        () => sessionResponse('saved', HOUR, { 'set-auth-token': 'renewed' }),
        { tokenStore },
      )
      await client.restore()
      expect(bearers()).toEqual(['Bearer saved'])
      expect(store.token).toBe('renewed')

      await client.restore()
      expect(bearers()).toEqual(['Bearer saved', 'Bearer renewed'])
      expect(store.save).toHaveBeenCalledOnce()

      await client.signOut()
      expect(store.token).toBeNull()
    })

    test('a tokenStore that fails does not break the session', async () => {
      const tokenStore: TokenStore = {
        load: () => Promise.reject(new Error('locked')),
        save: () => Promise.reject(new Error('locked')),
      }
      const { client, bearers } = setup(() => sessionResponse('t1', HOUR), { tokenStore })
      await client.restore()
      expect(bearers()).toEqual([null])
      expect(await client.getToken()).toBe('t1')
    })
  })
}
