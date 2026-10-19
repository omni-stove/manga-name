import { m } from '@manga/i18n'
import { toasts } from '../toasts'

/**
 * Desktop のログインの入り口を OS の既定のブラウザで開き、ログインはそちらで続くことをトーストで知らせる。
 * plugin-opener は Web のバンドルに入れないよう使うときに読み込む
 */
export async function openSignInInBrowser(url: string): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
  toasts.push(m.web_auth_continue_in_browser(), 'info')
}

if (import.meta.vitest) {
  const { afterEach, expect, test, vi } = import.meta.vitest
  const { installFakeTauri } = await import('./fake-tauri')

  afterEach(() => {
    vi.unstubAllGlobals()
    toasts.state.setState({ toasts: [] })
  })

  test('openSignInInBrowser opens the URL outside the app and says where to go on', async () => {
    const calls: [string, unknown][] = []
    installFakeTauri(vi.stubGlobal, (cmd, args) => {
      calls.push([cmd, args])
      return null
    })
    await openSignInInBrowser('https://api.test/v1/desktop-sign-in')
    expect(calls).toEqual([
      ['plugin:opener|open_url', { url: 'https://api.test/v1/desktop-sign-in', with: undefined }],
    ])
    expect(toasts.state.getState().toasts).toMatchObject([
      { kind: 'info', message: expect.stringContaining('ブラウザ') },
    ])
  })

  test('openSignInInBrowser does not tell to go on when the browser cannot be opened', async () => {
    installFakeTauri(vi.stubGlobal, () => {
      throw new Error('no browser')
    })
    await expect(openSignInInBrowser('https://api.test/')).rejects.toThrow('no browser')
    expect(toasts.state.getState().toasts).toEqual([])
  })
}
