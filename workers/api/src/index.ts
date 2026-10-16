import { createFakeImageProvider, createFakeLlmProvider } from '@manga/ai'
import { createAnthropicLlmProvider } from './anthropic-llm-provider'
import { createApp } from './app'
import { createGeminiImageProvider } from './gemini-image-provider'

export { ProjectRoom } from './room'

export default createApp({
  // キーが無ければ Fake にするのは、API キー無しの wrangler dev でもエディタの生成を通すため
  imageProvider: (env) =>
    env.GEMINI_API_KEY
      ? createGeminiImageProvider({
          apiKey: env.GEMINI_API_KEY,
          toPng: async (image) => {
            const result = await env.IMAGES.input(image.stream()).output({ format: 'image/png' })
            return new Blob([await new Response(result.image()).arrayBuffer()], {
              type: 'image/png',
            })
          },
        })
      : createFakeImageProvider(),
  llmProvider: (env) =>
    env.ANTHROPIC_API_KEY
      ? createAnthropicLlmProvider({ apiKey: env.ANTHROPIC_API_KEY })
      : createFakeLlmProvider(),
})
