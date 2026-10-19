import { type Context, Hono } from 'hono'
import { AUTH_BASE_PATH, getAuth } from './auth'
import type { Env } from './env'

/** Desktop が受ける deep link の scheme。apps/desktop の tauri.conf.json の deep-link と揃える */
const DESKTOP_SCHEME = 'manganame'

/**
 * Desktop のログインの口。Google は WebView の中での OAuth を断るので、Desktop は OS のブラウザでここを開く。
 *
 * - `GET /v1/desktop-sign-in?invite=<token>` は Google のログイン画面へ転送する。OAuth の state の Cookie をこのブラウザに置く。
 *   `invite` は招待リンクのトークンで、Web の signIn の `inviteToken` と同じく未登録のユーザーの登録に使う。
 * - Google から戻ると `GET /v1/desktop-sign-in/done` に着き、`manganame://auth?token=<one-time token>` へ転送する。
 *   Desktop はそのトークンを `POST /v1/auth/one-time-token/verify` でセッションに換える。
 *   ログインできなかったときは validateSignUp の値を、セッションが無ければ `no_session` を `manganame://auth?error=<code>` で返す。
 */
export function createDesktopSignInApp() {
  const app = new Hono<{ Bindings: Env }>()

  // Better Auth は auth.api から呼ぶと戻り先の URL と Cookie の名前を要求から決められないので、handler に要求を作って渡す
  const auth = (c: Context<{ Bindings: Env }>, path: string, init: RequestInit = {}) =>
    getAuth(c.env).handler(new Request(new URL(`${AUTH_BASE_PATH}${path}`, c.req.url), init))

  app.get('/', async (c) => {
    const invite = c.req.query('invite')
    const done = new URL('/v1/desktop-sign-in/done', c.req.url).toString()
    const res = await auth(c, '/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: done,
        errorCallbackURL: done,
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
    const back = new URL(`${DESKTOP_SCHEME}://auth`)
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
