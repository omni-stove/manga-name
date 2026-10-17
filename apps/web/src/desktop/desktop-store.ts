import type { Store } from '@tauri-apps/plugin-store'
import type { TokenStore } from '../auth'

let loading: Promise<Store> | undefined

/**
 * Desktop の設定ファイル（AppData の `desktop.json`）。最近開いたファイルと認証トークンを置く。
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
