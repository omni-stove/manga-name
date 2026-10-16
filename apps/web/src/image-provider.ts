import { createFakeImageProvider, createHttpImageProvider, type ImageProvider } from '@manga/ai'

export type { ImageProvider }

/** アプリ設定の AI プロキシ。どちらも未入力なら空文字 */
export interface AiProxySettings {
  baseUrl: string
  token: string
}

const AI_PROXY_BASE_URL_KEY = 'manga.aiProxy.baseUrl'
const AI_PROXY_TOKEN_KEY = 'manga.aiProxy.token'

/** localStorage のアプリ設定から AI プロキシの設定を読む。localStorage が無い環境では未設定 */
function readAiProxySettings(
  storage: Pick<Storage, 'getItem'> | null = localStorageOrNull(),
): AiProxySettings {
  return {
    baseUrl: storage?.getItem(AI_PROXY_BASE_URL_KEY)?.trim() ?? '',
    token: storage?.getItem(AI_PROXY_TOKEN_KEY)?.trim() ?? '',
  }
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
 * 画面に DI する ImageProvider。プロキシの URL が入っていれば Workers のプロキシを叩き、
 * 無ければ Fake を返す。`createPanelGeneration` がこれで生成する
 */
export function createImageProvider(
  settings: AiProxySettings = readAiProxySettings(),
): ImageProvider {
  if (settings.baseUrl === '') return createFakeImageProvider()
  return createHttpImageProvider({
    baseUrl: settings.baseUrl,
    getToken: async () => (settings.token === '' ? null : settings.token),
  })
}
