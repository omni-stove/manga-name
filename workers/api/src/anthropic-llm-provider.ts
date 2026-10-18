import { createAnthropic } from '@ai-sdk/anthropic'
import { type LlmPrompt, type LlmProvider, prompts } from '@manga/ai'
import type { CritiqueResponse, LayoutSuggestionResponse, PagePlan } from '@manga/schema'
import { generateText, type JSONSchema7, jsonSchema, Output } from 'ai'

const ANTHROPIC_LLM_MODEL = 'claude-haiku-5-5'

/** 64 ページ分の流れ、登場キャラ、ページごとの脚本の原文、脚本のセリフ全部を返しても切れない上限 */
const MAX_PLAN_OUTPUT_TOKENS = 64_000
/** 1 ページのコマ割りの案 3 つを、コマごとの描くものとセリフつきで返しても切れない上限 */
const MAX_LAYOUT_OUTPUT_TOKENS = 8_000
/** 1 ページの講評と提案 5 件で切れない上限 */
const MAX_CRITIQUE_OUTPUT_TOKENS = 8_000

export interface AnthropicLlmProviderOptions {
  apiKey: string
}

/**
 * AI SDK 経由で Anthropic `claude-haiku-5-5` に planPages、suggestLayout、critique をさせる LlmProvider。
 * prompts の system と user を送り、schema を構造化出力に渡して、応答の JSON をそのまま返す。
 * 型どおりかの検証と再試行は呼び出し側に任せる。JSON にならない応答や HTTP エラーは throw する。
 */
export function createAnthropicLlmProvider(opts: AnthropicLlmProviderOptions): LlmProvider {
  const model = createAnthropic({ apiKey: opts.apiKey })(ANTHROPIC_LLM_MODEL)

  async function generate<T>(
    { system, user }: LlmPrompt,
    spec: Output.Output<T>,
    maxOutputTokens: number,
  ) {
    const { output } = await generateText({
      model,
      system,
      prompt: user,
      // AI SDK の再試行は切る。呼び出し側の再試行と重なると、1 要求で何度も課金されるため
      maxRetries: 0,
      maxOutputTokens,
      output: spec,
      providerOptions: {
        // ざっくり提案してざっくり直す用途なので、思考を浅くして費用と待ち時間を抑える
        anthropic: { structuredOutputMode: 'outputFormat', effort: 'low' },
      },
    })
    return output
  }

  // jsonSchema に validate を渡さないのは、範囲と参照整合まで見る Zod の検証を呼び出し側が持つため
  const schemaOf = <T>(schema: LlmPrompt['schema']) => jsonSchema<T>(schema as JSONSchema7)

  return {
    planPages: (req) => {
      const prompt = prompts.planPages(req)
      // 構造化出力は根を object に限るので、AI SDK に { elements: [...] } で包ませて配列で受け取る
      const element = schemaOf<PagePlan>(prompt.schema.items as LlmPrompt['schema'])
      return generate(prompt, Output.array({ element }), MAX_PLAN_OUTPUT_TOKENS)
    },
    suggestLayout: (req) => {
      const prompt = prompts.suggestLayout(req)
      const schema = schemaOf<LayoutSuggestionResponse>(prompt.schema)
      return generate(prompt, Output.object({ schema }), MAX_LAYOUT_OUTPUT_TOKENS)
    },
    critique: (req) => {
      const prompt = prompts.critique(req)
      const schema = schemaOf<CritiqueResponse>(prompt.schema)
      return generate(prompt, Output.object({ schema }), MAX_CRITIQUE_OUTPUT_TOKENS)
    },
  }
}
