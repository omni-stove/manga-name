import {
  createFakeLlmProvider,
  createHttpLlmProvider,
  type HttpProviderOptions,
  type LlmProvider,
} from '@manga/ai'

export type { LlmProvider }

/**
 * 画面に DI する LlmProvider。createImageProvider と同じく、API の URL があれば Workers のプロキシを
 * ログインのトークンで叩き、無ければ Fake を返す
 */
export function createLlmProvider(opts: HttpProviderOptions): LlmProvider {
  if (opts.baseUrl === '') return createFakeLlmProvider()
  return createHttpLlmProvider(opts)
}
