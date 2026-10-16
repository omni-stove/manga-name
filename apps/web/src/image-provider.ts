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
