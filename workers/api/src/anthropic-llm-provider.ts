import { createAnthropic } from '@ai-sdk/anthropic'
import { type LlmProvider, prompts } from '@manga/ai'
import type { LayoutProposalResponse } from '@manga/schema'
import { generateText, type JSONSchema7, jsonSchema, Output } from 'ai'

const ANTHROPIC_LLM_MODEL = 'claude-haiku-5-5'

/** 脚本 20,000 字から数十ページの提案を返しても切れない上限 */
const MAX_OUTPUT_TOKENS = 64_000

export interface AnthropicLlmProviderOptions {
  apiKey: string
}

/**
 * AI SDK 経由で Anthropic `claude-haiku-5-5` に proposeLayout させる LlmProvider。
 * prompts.proposeLayout の system と user を送り、schema を構造化出力に渡して、応答の JSON をそのまま返す。
 * 型どおりかの検証と再試行は呼び出し側に任せる。JSON にならない応答や HTTP エラーは throw する。
 * critique は WS-16 の prompts.critique ができるまで throw する。
 */
export function createAnthropicLlmProvider(opts: AnthropicLlmProviderOptions): LlmProvider {
  const model = createAnthropic({ apiKey: opts.apiKey })(ANTHROPIC_LLM_MODEL)

  return {
    async proposeLayout(req) {
      const { system, user, schema } = prompts.proposeLayout(req)
      const { output } = await generateText({
        model,
        system,
        prompt: user,
        // AI SDK の再試行は切る。呼び出し側の再試行と重なると、1 要求で何度も課金されるため
        maxRetries: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // jsonSchema に validate を渡さないのは、範囲と参照整合まで見る Zod の検証を呼び出し側が持つため
        output: Output.object({
          schema: jsonSchema<LayoutProposalResponse>(schema as JSONSchema7),
        }),
        providerOptions: {
          // ざっくり提案してざっくり直す用途なので、思考を浅くして費用と待ち時間を抑える
          anthropic: { structuredOutputMode: 'outputFormat', effort: 'low' },
        },
      })
      return output
    },
    async critique() {
      throw new Error(`critique is not implemented for ${ANTHROPIC_LLM_MODEL}`)
    },
  }
}
