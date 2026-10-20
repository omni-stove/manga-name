import type { Store } from '@tauri-apps/plugin-store'
import type { TokenStore } from '../auth'

let loading: Promise<Store> | undefined

/**
 * Desktop の設定ファイル（AppData の `desktop.json`）。最近開いたファイル、プロジェクトごとの書き出し先フォルダ、認証トークンを置く。
 * plugin-store は最初に使うときに読み込み、Web のバンドルには入れない
 */
export function desktopStore(): Promise<Store> {
  loading ??= import('@tauri-apps/plugin-store')
    .then((m) => m.load('desktop.json'))
    .catch((e) => {
      loading = undefined
      throw e
    })
  return loading
}

const TOKEN_KEY = 'authToken'

/** 認証トークンを desktop.json に置く TokenStore。Desktop の WebView は再起動で API の Cookie を持ち越せないため */
export function createDesktopTokenStore(): TokenStore {
  return {
    async load() {
      return (await (await desktopStore()).get<string>(TOKEN_KEY)) ?? null
    },
    async save(token) {
      const store = await desktopStore()
      if (token === null) await store.delete(TOKEN_KEY)
      else await store.set(TOKEN_KEY, token)
      await store.save()
    },
  }
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest
  const { createFakeStoreIpc, installFakeTauri } = await import('./fake-tauri')

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('desktopStore', () => {
    test('loads desktop.json once, and loads it again after a failure', async () => {
      const store = createFakeStoreIpc()
      let fail = true
      const load = vi.fn((args: unknown) => {
        if (fail) throw new Error('not ready')
        return store.handle('plugin:store|load', args)
      })
      installFakeTauri(vi.stubGlobal, (cmd, args) =>
        cmd === 'plugin:store|load' ? load(args) : store.handle(cmd, args),
      )
      await expect(desktopStore()).rejects.toThrow('not ready')
      fail = false
      const [a, b] = await Promise.all([desktopStore(), desktopStore()])
      expect(a).toBe(b)
      expect(await desktopStore()).toBe(a)
      expect(load).toHaveBeenCalledTimes(2)
      expect(load).toHaveBeenLastCalledWith({ path: 'desktop.json', options: undefined })
    })
  })

  describe('createDesktopTokenStore', () => {
    test('saves, loads and deletes the token, writing the file each time', async () => {
      const store = createFakeStoreIpc()
      installFakeTauri(vi.stubGlobal, (cmd, args) => store.handle(cmd, args))
      const tokens = createDesktopTokenStore()
      expect(await tokens.load()).toBeNull()
      await tokens.save('t1')
      expect(store.values.get('authToken')).toBe('t1')
      expect(await tokens.load()).toBe('t1')
      await tokens.save(null)
      expect(store.values.has('authToken')).toBe(false)
      expect(await tokens.load()).toBeNull()
      expect(store.calls.filter((c) => c === 'plugin:store|save')).toHaveLength(2)
    })
  })
}
