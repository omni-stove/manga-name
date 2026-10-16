/** ログイン中のユーザー。Better Auth の user の画面で使う分だけ */
export interface AuthUser {
  id: string
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
  /** Google のログイン画面へ移る。戻ってくると今の URL に着く */
  signIn(): Promise<void>
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
    setSession({
      token,
      expiresAt: Date.parse(body.session.expiresAt),
      user: {
        id: body.user.id,
        name: body.user.name,
        email: body.user.email,
        image: body.user.image ?? null,
      },
    })
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
    if (session === null) return refreshing ? refreshing : null
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
    async signIn() {
      if (baseUrl === '') throw new Error('API の URL が設定されていない')
      const res = await authFetch('/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: window.location.href }),
      })
      if (!res.ok) throw new Error(`sign-in failed: ${res.status}`)
      const { url } = (await res.json()) as { url?: string }
      if (!url) throw new Error('sign-in failed: no redirect URL')
      navigate(url)
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

interface GetSessionBody {
  session?: { token: string; expiresAt: string }
  user?: { id: string; name: string; email: string; image?: string | null }
}
