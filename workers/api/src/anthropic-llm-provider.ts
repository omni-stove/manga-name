import Anthropic from '@anthropic-ai/sdk'
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema'
import { type LlmPrompt, type LlmProvider, prompts } from '@manga/ai'
import type { JsonSchema } from '@manga/schema'
import { z } from 'zod'

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
 * Anthropic `claude-haiku-5-5` に planPages、suggestLayout、critique をさせる LlmProvider。
 * prompts の system と user を送り、schema を構造化出力に渡して、応答の JSON を output で検証して返す。
 * 最後まで書き終えていない応答、JSON にならない応答、output を通らない応答、HTTP エラーは throw する。
 */
export function createAnthropicLlmProvider(opts: AnthropicLlmProviderOptions): LlmProvider {
  // SDK の再試行は切る。呼び出し側の再試行と重なると、1 要求で何度も課金されるため
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 })

  async function generate(
    { system, user }: LlmPrompt<unknown>,
    schema: JsonSchema,
    maxTokens: number,
  ) {
    // 非 streaming では SDK が max_tokens 64,000 の要求を 10 分を超える恐れで断るので、streaming で受ける
    const message = await client.messages
      .stream({
        model: ANTHROPIC_LLM_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: {
          // ざっくり提案してざっくり直す用途なので、思考を浅くして費用と待ち時間を抑える
          effort: 'low',
          // 構造化出力が受け付けない制約（minLength など）は SDK の変換で description に移す
          format: { type: 'json_schema', schema: transformJSONSchema(schema) },
        },
      })
      .finalMessage()
    if (message.stop_reason !== 'end_turn') {
      throw new Error(`anthropic stopped with ${message.stop_reason}`)
    }
    const text = message.content.find((block) => block.type === 'text')?.text ?? ''
    return JSON.parse(text) as unknown
  }

  function check<T>(output: z.ZodType<T>, value: unknown): T {
    const result = output.safeParse(value)
    if (!result.success) throw new Error(`invalid llm output\n${z.prettifyError(result.error)}`)
    return result.data
  }

  return {
    planPages: async (req) => {
      const prompt = prompts.planPages(req)
      // 構造化出力は根を object に限るので、配列を { elements } で包ませて受け取る
      const schema: JsonSchema = {
        type: 'object',
        additionalProperties: false,
        required: ['elements'],
        properties: { elements: prompt.schema },
      }
      const reply = await generate(prompt, schema, MAX_PLAN_OUTPUT_TOKENS)
      return check(prompt.output, (reply as { elements?: unknown } | null)?.elements)
    },
    suggestLayout: async (req) => {
      const prompt = prompts.suggestLayout(req)
      return check(prompt.output, await generate(prompt, prompt.schema, MAX_LAYOUT_OUTPUT_TOKENS))
    },
    critique: async (req) => {
      const prompt = prompts.critique(req)
      return check(prompt.output, await generate(prompt, prompt.schema, MAX_CRITIQUE_OUTPUT_TOKENS))
    },
  }
}
