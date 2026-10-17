import {
  createFakeImageProvider,
  createHttpImageProvider,
  type HttpProviderOptions,
  type ImageProvider,
} from '@manga/ai'

export type { ImageProvider }

const API_BASE_URL_KEY = 'manga.aiProxy.baseUrl'
// 共有アクセストークンの頃に保存したもの。ログインに置き換えたので読まずに消す
const LEGACY_TOKEN_KEY = 'manga.aiProxy.token'

/**
 * workers/api のオリジン。localStorage のアプリ設定を優先し、無ければビルド時の `VITE_API_BASE_URL`。
 * どちらも無ければ空文字で、API を使わずに動く
 */
export function readApiBaseUrl(
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null = localStorageOrNull(),
): string {
  storage?.removeItem(LEGACY_TOKEN_KEY)
  const saved = storage?.getItem(API_BASE_URL_KEY)?.trim() ?? ''
  if (saved !== '') return saved
  const built: unknown = import.meta.env.VITE_API_BASE_URL
  return typeof built === 'string' ? built.trim() : ''
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // ストレージを塞いだブラウザでは参照だけで SecurityError になる
    return null
  }
}

/**
 * 画面に DI する ImageProvider。API の URL があれば Workers のプロキシをログインのトークンで叩き、
 * 無ければ Fake を返す。`createPanelGeneration` がこれで生成する
 */
export function createImageProvider(opts: HttpProviderOptions): ImageProvider {
  if (opts.baseUrl === '') return createFakeImageProvider()
  return createHttpImageProvider(opts)
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const storageWith = (items: Record<string, string>) => {
    const map = new Map(Object.entries(items))
    return {
      map,
      getItem: (key: string) => map.get(key) ?? null,
      removeItem: (key: string) => void map.delete(key),
    }
  }

  describe('readApiBaseUrl', () => {
    test('the saved app setting wins over the build-time URL', () => {
      vi.stubEnv('VITE_API_BASE_URL', 'https://built.test')
      const storage = storageWith({ [API_BASE_URL_KEY]: ' https://saved.test ' })
      expect(readApiBaseUrl(storage)).toBe('https://saved.test')
    })

    test('a blank or missing setting falls back to the build-time URL', () => {
      vi.stubEnv('VITE_API_BASE_URL', ' https://built.test ')
      expect(readApiBaseUrl(storageWith({ [API_BASE_URL_KEY]: '  ' }))).toBe('https://built.test')
      expect(readApiBaseUrl(null)).toBe('https://built.test')
    })

    test('without either it is empty', () => {
      vi.stubEnv('VITE_API_BASE_URL', undefined)
      expect(readApiBaseUrl(storageWith({}))).toBe('')
    })

    test('the legacy shared token is removed', () => {
      const storage = storageWith({ [LEGACY_TOKEN_KEY]: 'secret' })
      readApiBaseUrl(storage)
      expect(storage.map.has(LEGACY_TOKEN_KEY)).toBe(false)
    })
  })
}
