import { type Context, Hono } from 'hono'
import { ApiException } from './api-error'
import { AUTH_BASE_PATH, getAuth } from './auth'
import type { Env } from './env'

/** Desktop が受ける deep link の scheme。apps/desktop の tauri.conf.json の deep-link と揃える */
const DESKTOP_SCHEME = 'manganame'

/** `port` の値が 1024〜65535 の整数ならその数、無いか違えば null */
function loopbackPort(value: string | undefined): number | null {
  const port = Number(value)
  return value !== undefined && Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : null
}

/**
 * Desktop と CLI のログインの口。Google は WebView の中での OAuth を断るので、Desktop は OS のブラウザでここを開く。
 *
 * - `GET /v1/desktop-sign-in?invite=<token>` は Google のログイン画面へ転送する。OAuth の state の Cookie をこのブラウザに置く。
 *   `invite` は招待リンクのトークンで、Web の signIn の `inviteToken` と同じく未登録のユーザーの登録に使う。
 *   `port` を付けると、戻り先を Desktop の deep link ではなく `http://127.0.0.1:<port>/` にする（CLI が待ち受ける）。1024〜65535 以外は 400。
 * - Google から戻ると `GET /v1/desktop-sign-in/done` に着き、`manganame://auth?token=<one-time token>`（`port` 付きなら
 *   `http://127.0.0.1:<port>/?token=...`）へ転送する。受け手はそのトークンを `POST /v1/auth/one-time-token/verify` でセッションに換える。
 *   ログインできなかったときは validateSignUp の値を、セッションが無ければ `no_session` を `?error=<code>` で返す。
 */
export function createDesktopSignInApp() {
  const app = new Hono<{ Bindings: Env }>()

  // Better Auth は auth.api から呼ぶと戻り先の URL と Cookie の名前を要求から決められないので、handler に要求を作って渡す
  const auth = (c: Context<{ Bindings: Env }>, path: string, init: RequestInit = {}) =>
    getAuth(c.env).handler(new Request(new URL(`${AUTH_BASE_PATH}${path}`, c.req.url), init))

  app.get('/', async (c) => {
    const invite = c.req.query('invite')
    const port = c.req.query('port')
    if (port !== undefined && loopbackPort(port) === null) {
      throw new ApiException('invalid_request', { detail: 'port must be 1024-65535' })
    }
    const done = new URL('/v1/desktop-sign-in/done', c.req.url)
    if (port !== undefined) done.searchParams.set('port', port)
    const res = await auth(c, '/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: done.toString(),
        errorCallbackURL: done.toString(),
        ...(invite !== undefined && invite !== '' && { additionalData: { inviteToken: invite } }),
      }),
    })
    if (!res.ok) return res
    const { url } = (await res.json()) as { url: string }
    const headers = new Headers({ location: url })
    for (const cookie of res.headers.getSetCookie()) headers.append('set-cookie', cookie)
    return new Response(null, { status: 302, headers })
  })

  app.get('/done', async (c) => {
    const port = loopbackPort(c.req.query('port'))
    // 127.0.0.1 に限るのは、トークンをこの端末の外へ転送させないため
    const back = new URL(port === null ? `${DESKTOP_SCHEME}://auth` : `http://127.0.0.1:${port}/`)
    const error = c.req.query('error')
    if (error !== undefined) {
      back.searchParams.set('error', error)
      return c.redirect(back.toString())
    }
    const res = await auth(c, '/one-time-token/generate', { headers: c.req.raw.headers })
    if (!res.ok) {
      back.searchParams.set('error', 'no_session')
      return c.redirect(back.toString())
    }
    const { token } = (await res.json()) as { token: string }
    back.searchParams.set('token', token)
    return c.redirect(back.toString())
  })

  return app
}
