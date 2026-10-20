import { m } from '@manga/i18n'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { type AuthClient, takeSignInError } from '../auth'
import { errorMessage } from '../route-error'
import type { createAppRouter } from '../router'
import { toasts } from '../toasts'

/** apps/desktop の tauri.conf.json の deep-link と、workers/api の desktop-sign-in の scheme */
const SCHEME = 'manganame:'

/** Desktop が受ける deep link の中身 */
type DeepLink =
  | { kind: 'signed-in'; token: string }
  | { kind: 'sign-in-error'; message: string }
  | { kind: 'invite'; token: string }

/**
 * deep link を読む。`manganame://auth?token=<one-time token>` は OS のブラウザでのログインからの戻り、
 * `manganame://auth?error=<code>` はログインできなかった戻り、`manganame://invite/<token>` は招待リンク。
 * それ以外は null
 */
export function parseDeepLink(raw: string): DeepLink | null {
  if (!URL.canParse(raw)) return null
  const url = new URL(raw)
  if (url.protocol !== SCHEME) return null
  if (url.host === 'auth') {
    const error = takeSignInError(url)
    if (error) return { kind: 'sign-in-error', message: error.message }
    const token = url.searchParams.get('token')
    return token ? { kind: 'signed-in', token } : null
  }
  if (url.host === 'invite') {
    const token = decodeURIComponent(url.pathname.slice(1))
    return token ? { kind: 'invite', token } : null
  }
  return null
}

export interface DeepLinkOptions {
  router: Pick<ReturnType<typeof createAppRouter>, 'navigate'>
  auth: Pick<AuthClient, 'completeSignIn'>
}

/**
 * deep link を受けて、ログインを終える、ログインできなかった理由をトーストで出す、招待の受け口を開く。
 * 起動のきっかけになった deep link も読む。受けたらウィンドウを前に出す
 */
export async function startDeepLinks({ router, auth }: DeepLinkOptions): Promise<void> {
  const handle = (urls: readonly string[]) => {
    for (const link of urls.map(parseDeepLink)) {
      if (link === null) continue
      if (link.kind === 'signed-in') {
        auth
          .completeSignIn(link.token)
          .catch((e: unknown) => toasts.push(m.web_sign_in_failed({ reason: errorMessage(e) })))
      } else if (link.kind === 'sign-in-error') {
        toasts.push(link.message)
      } else {
        void router.navigate({ to: '/invite/$token', params: { token: link.token } })
      }
    }
    // 前に出せなくても受けた処理は済んでいる
    void getCurrentWindow()
      .setFocus()
      .catch(() => {})
  }
  const initial = await getCurrent()
  if (initial) handle(initial)
  await onOpenUrl(handle)
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest
  const { installFakeTauri } = await import('./fake-tauri')

  afterEach(() => {
    vi.unstubAllGlobals()
    toasts.state.setState({ toasts: [] })
  })

  describe('parseDeepLink', () => {
    test('reads the sign-in token, the sign-in error and the invite', () => {
      expect(parseDeepLink('manganame://auth?token=ott')).toEqual({
        kind: 'signed-in',
        token: 'ott',
      })
      expect(parseDeepLink('manganame://auth?error=invite_required')).toEqual({
        kind: 'sign-in-error',
        message: m.web_sign_in_error_invite_required(),
      })
      expect(parseDeepLink('manganame://invite/a%2Fb')).toEqual({ kind: 'invite', token: 'a/b' })
    })

    test('ignores other schemes, hosts, and links without a token', () => {
      for (const raw of [
        'https://auth?token=ott',
        'manganame://other?token=ott',
        'manganame://auth',
        'manganame://invite/',
        'not a url',
      ]) {
        expect(parseDeepLink(raw)).toBeNull()
      }
    })
  })

  describe('startDeepLinks', () => {
    const setup = (initial: string[] | null) => {
      const calls: string[] = []
      installFakeTauri(vi.stubGlobal, (cmd) => {
        calls.push(cmd)
        if (cmd === 'plugin:deep-link|get_current') return initial
        if (cmd === 'plugin:event|listen') return 1
        return null
      })
      const auth = { completeSignIn: vi.fn(async (_token: string) => {}) }
      const router = { navigate: vi.fn(async () => {}) }
      return { calls, auth, router }
    }

    test('handles the link that launched the app, then listens and brings the window up', async () => {
      const { calls, auth, router } = setup([
        'manganame://auth?token=ott',
        'manganame://invite/t1',
        'manganame://auth?error=invite_email_mismatch',
      ])
      await startDeepLinks({ router, auth })
      expect(auth.completeSignIn).toHaveBeenCalledExactlyOnceWith('ott')
      expect(router.navigate).toHaveBeenCalledExactlyOnceWith({
        to: '/invite/$token',
        params: { token: 't1' },
      })
      expect(toasts.state.getState().toasts.map((t) => t.message)).toEqual([
        m.web_sign_in_error_invite_email_mismatch(),
      ])
      expect(calls).toContain('plugin:event|listen')
      expect(calls).toContain('plugin:window|set_focus')
    })

    test('tells when the token cannot be turned into a session', async () => {
      const { auth, router } = setup(['manganame://auth?token=ott'])
      auth.completeSignIn.mockRejectedValue(new Error('expired'))
      await startDeepLinks({ router, auth })
      await vi.waitFor(() =>
        expect(toasts.state.getState().toasts.map((t) => t.message)).toEqual([
          expect.stringContaining('expired'),
        ]),
      )
    })

    test('without a launching link it only listens', async () => {
      const { calls, auth, router } = setup(null)
      await startDeepLinks({ router, auth })
      expect(auth.completeSignIn).not.toHaveBeenCalled()
      expect(calls).not.toContain('plugin:window|set_focus')
      expect(calls).toContain('plugin:event|listen')
    })
  })
}
