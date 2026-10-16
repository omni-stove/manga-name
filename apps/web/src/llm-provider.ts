import {
  createFakeLlmProvider,
  createHttpLlmProvider,
  type HttpProviderOptions,
  type LlmProvider,
} from '@manga/ai'

export type { LlmProvider }

/**
 * 画面に DI する LlmProvider。API の URL があれば Workers のプロキシをログインのトークンで叩き、
 * 無ければ Fake を返す。「脚本から下書き」がこれでページ案を作る
 */
export function createLlmProvider(opts: HttpProviderOptions): LlmProvider {
  if (opts.baseUrl === '') return createFakeLlmProvider()
  return createHttpLlmProvider(opts)
}
