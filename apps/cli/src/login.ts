import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { m } from '@manga/i18n'

/** ブラウザでのログインを待つ上限 */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

export interface LoginOptions {
  /** workers/api のオリジン。末尾の `/` は無視する */
  apiUrl: string
  /** 招待リンクのトークン。未登録のユーザーはこれが無いと登録できない */
  invite?: string
  /** ログインの URL をブラウザで開く */
  openUrl(url: string): void
  fetch?: typeof fetch
  timeoutMs?: number
}

/**
 * ブラウザで Google にログインさせ、セッショントークンを返す。
 * 127.0.0.1 の空いているポートで待ち受け、`/v1/desktop-sign-in?port=<port>` を開く。戻ってきた one-time token を
 * `POST /v1/auth/one-time-token/verify` でセッションに換える。ログインできなかったとき、timeoutMs を過ぎたときは throw する
 */
export async function login(opts: LoginOptions): Promise<string> {
  const apiUrl = opts.apiUrl.replace(/\/+$/, '')
  const doFetch = opts.fetch ?? fetch
  const oneTimeToken = await waitForRedirect(opts, apiUrl)
  const res = await doFetch(`${apiUrl}/v1/auth/one-time-token/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: oneTimeToken }),
  })
  if (!res.ok) throw new Error(m.cli_login_failed({ error: `verify ${res.status}` }))
  const body = (await res.json()) as { session?: { token?: unknown } }
  const token = res.headers.get('set-auth-token') ?? body.session?.token
  if (typeof token !== 'string') throw new Error(m.cli_login_failed({ error: 'no session' }))
  return token
}

/** 待ち受けを始めてログインの URL を開き、戻ってきた `?token=` を返す。`?error=` なら throw する */
function waitForRedirect(opts: LoginOptions, apiUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const token = url.searchParams.get('token')
      const error = url.searchParams.get('error')
      // favicon などログインの戻りでない要求には答えるだけにする
      if (token === null && error === null) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(token ? m.cli_login_page_done() : m.cli_login_failed({ error: error ?? '' }))
      finish(() =>
        token ? resolve(token) : reject(new Error(m.cli_login_failed({ error: error ?? '' }))),
      )
    })
    const timeoutMs = opts.timeoutMs ?? LOGIN_TIMEOUT_MS
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error(m.cli_login_timeout({ minutes: Math.ceil(timeoutMs / 60_000) }))),
        ),
      timeoutMs,
    )
    const finish = (settle: () => void) => {
      clearTimeout(timer)
      server.close()
      server.closeAllConnections()
      settle()
    }
    server.on('error', (e) => finish(() => reject(e)))
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const url = new URL(`${apiUrl}/v1/desktop-sign-in`)
      url.searchParams.set('port', String(port))
      if (opts.invite) url.searchParams.set('invite', opts.invite)
      opts.openUrl(url.toString())
    })
  })
}

/** url を OS の既定のブラウザで開く。開けなくても失敗にしない（呼び出し側が URL を表示する） */
export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref()
}

if (import.meta.vitest) {
  const { expect, test, vi } = import.meta.vitest

  /** 開かれたログインの URL から待ち受けのポートを読み、そこへ query で戻る */
  const comeBackWith = (query: string) => (url: string) => {
    const port = new URL(url).searchParams.get('port')
    void fetch(`http://127.0.0.1:${port}/?${query}`)
  }

  test('exchanges the one-time token that comes back for a session token', async () => {
    const opened: string[] = []
    const verify = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.test/v1/auth/one-time-token/verify')
      expect(JSON.parse(init.body as string)).toEqual({ token: 'ott' })
      return Response.json({ session: { token: 'session' } })
    })
    const token = await login({
      apiUrl: 'https://api.test/',
      invite: 'inv',
      openUrl: (url) => {
        opened.push(url)
        comeBackWith('token=ott')(url)
      },
      fetch: verify as typeof fetch,
    })
    expect(token).toBe('session')
    const url = new URL(opened[0] ?? '')
    expect(`${url.origin}${url.pathname}`).toBe('https://api.test/v1/desktop-sign-in')
    expect(url.searchParams.get('invite')).toBe('inv')
    expect(Number(url.searchParams.get('port'))).toBeGreaterThanOrEqual(1024)
  })

  test('throws the error that comes back, a failed verify and a timeout', async () => {
    const noSession = (async () => Response.json({})) as unknown as typeof fetch
    await expect(
      login({ apiUrl: 'https://api.test', openUrl: comeBackWith('error=invite_required') }),
    ).rejects.toThrow('invite_required')
    await expect(
      login({
        apiUrl: 'https://api.test',
        openUrl: comeBackWith('token=ott'),
        fetch: (async () => new Response(null, { status: 401 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow('401')
    await expect(
      login({ apiUrl: 'https://api.test', openUrl: comeBackWith('token=ott'), fetch: noSession }),
    ).rejects.toThrow('no session')
    await expect(
      login({ apiUrl: 'https://api.test', openUrl: () => {}, timeoutMs: 10 }),
    ).rejects.toThrow(m.cli_login_timeout({ minutes: 1 }))
  })
}
