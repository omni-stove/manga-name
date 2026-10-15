import {
  createFakeImageProvider,
  createFakeLlmProvider,
  type ImageProvider,
  type LlmProvider,
  PROMPT_HEADER,
  PROVIDER_HEADER,
} from '@manga/ai'
import {
  LayoutProposalResponseSchema,
  PanelArtRequestSchema,
  ProjectBaseSchema,
} from '@manga/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from './env'
import { isDecodablePng } from './png'
import { reserveUsage, settleUsage, sha256Hex } from './usage'

/** 応答が不正なときの再試行を含めた、プロバイダを呼ぶ最大回数 */
const MAX_ATTEMPTS = 2

/** 脚本の最大文字数。LLM に渡すトークン数とその費用を 1 要求あたりで抑えるため */
const MAX_SCRIPT_LENGTH = 20_000
/** ページ数の目安の上限 */
const MAX_PAGE_COUNT = 64

/** multipart の json 部。PanelArtRequest から Blob を除き、previous は修正指示だけにしたもの */
const PanelArtJsonSchema = PanelArtRequestSchema.omit({
  layoutPng: true,
  referencePng: true,
  characterRefs: true,
  previous: true,
}).extend({ previous: z.object({ instruction: z.string() }).optional() })

/** `@manga/ai` の LayoutProposalRequest */
const LayoutProposalRequestSchema = z.object({
  project: ProjectBaseSchema.pick({ settings: true, characters: true }),
  script: z.string().trim().min(1).max(MAX_SCRIPT_LENGTH),
  pageCount: z.number().int().min(1).max(MAX_PAGE_COUNT).optional(),
})

export interface AppOptions {
  /** 画像生成プロバイダ。実プロバイダの API キーは env にだけ置くので env を受け取る。既定は Fake */
  imageProvider?: (env: Env) => ImageProvider
  /** LLM プロバイダ。env を受け取る理由は imageProvider と同じ。既定は Fake */
  llmProvider?: (env: Env) => LlmProvider
}

/** Authorization: Bearer が APP_ACCESS_TOKEN と一致すればそのトークンを返す */
async function authenticate(header: string | undefined, expected: string) {
  const match = header?.match(/^Bearer (.+)$/)
  const token = match?.[1]
  if (token === undefined || !expected) return null
  // ハッシュ同士を比べるのは、トークンの長さと内容を応答時間から推測させないため
  const [given, wanted] = await Promise.all([sha256Hex(token), sha256Hex(expected)])
  return given === wanted ? given : null
}

/**
 * call を最大 MAX_ATTEMPTS 回呼び、最初に undefined 以外を返した値と、呼んだ回数を返す。
 * 使い切れば value は undefined。call の throw も不正応答と同じ失敗として数える。
 */
async function retryUntilValid<T>(
  call: () => Promise<T | undefined>,
): Promise<{ value: T | undefined; attempts: number }> {
  let attempts = 0
  while (attempts < MAX_ATTEMPTS) {
    attempts++
    try {
      const value = await call()
      if (value !== undefined) return { value, attempts }
    } catch {
      // プロバイダの一時的な失敗も不正応答と同じく再試行し、使い切れば 502 にする
    }
  }
  return { value: undefined, attempts }
}

const isFile = (v: unknown): v is File => typeof v !== 'string' && v !== null && v !== undefined

/** Workers のプロキシ。`GET /v1/health`、`POST /v1/ai/panel-art`、`POST /v1/ai/propose-layout` */
export function createApp(options: AppOptions = {}) {
  const createImage = options.imageProvider ?? (() => createFakeImageProvider())
  const createLlm = options.llmProvider ?? (() => createFakeLlmProvider())
  const app = new Hono<{ Bindings: Env; Variables: { tokenHash: string } }>()

  /**
   * ai_usage に 1 行予約し、その id を返す。上限に達していれば null。
   * プロバイダを呼ぶ前に呼ぶ。呼び終えてから数えると、並行する要求がすべて判定を通ってしまう
   */
  const reserve = (env: Env, tokenHash: string, kind: string) =>
    reserveUsage(env.DB, { tokenHash, kind, now: Date.now() })

  app.get('/v1/health', (c) => c.json({ ok: true }))

  app.use('/v1/ai/*', async (c, next) => {
    const tokenHash = await authenticate(c.req.header('authorization'), c.env.APP_ACCESS_TOKEN)
    if (tokenHash === null) return c.json({ error: 'unauthorized' }, 401)
    c.set('tokenHash', tokenHash)
    await next()
  })

  app.post('/v1/ai/panel-art', async (c) => {
    const form = await c.req.formData().catch(() => null)
    const rawJson = form?.get('json')
    const layout = form?.get('layout')
    if (!form || typeof rawJson !== 'string' || !isFile(layout)) {
      return c.json({ error: 'json and layout are required' }, 400)
    }
    let parsed: z.ZodSafeParseResult<z.infer<typeof PanelArtJsonSchema>>
    try {
      parsed = PanelArtJsonSchema.safeParse(JSON.parse(rawJson))
    } catch {
      return c.json({ error: 'json is not valid JSON' }, 400)
    }
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
    const { previous, ...rest } = parsed.data

    const referencePng = form.get('reference')
    const previousArt = form.get('previous')
    if (previous && !isFile(previousArt)) {
      return c.json({ error: 'previous image is required with previous.instruction' }, 400)
    }
    const characterRefs = [...form.entries()].flatMap(([key, value]) =>
      key.startsWith('character_') && isFile(value)
        ? [{ characterId: key.slice('character_'.length), image: value }]
        : [],
    )
    const usageId = await reserve(c.env, c.get('tokenHash'), 'panel-art')
    if (usageId === null) {
      return c.json({ error: 'rate limit exceeded' }, 429, { 'retry-after': '60' })
    }
    const provider = createImage(c.env)

    const { value, attempts } = await retryUntilValid(async () => {
      const res = await provider.generatePanelArt({
        ...rest,
        layoutPng: layout,
        referencePng: isFile(referencePng) ? referencePng : undefined,
        characterRefs: characterRefs.length > 0 ? characterRefs : undefined,
        previous:
          previous && isFile(previousArt)
            ? { art: previousArt, instruction: previous.instruction }
            : undefined,
      })
      const bytes = new Uint8Array(await res.image.arrayBuffer())
      return isDecodablePng(bytes) ? { res, bytes } : undefined
    })
    await settleUsage(c.env.DB, usageId, attempts)

    if (value === undefined) {
      return c.json({ error: 'image provider returned an invalid image' }, 502)
    }
    return c.body(value.bytes, 200, {
      'content-type': 'image/png',
      [PROVIDER_HEADER]: value.res.provider,
      [PROMPT_HEADER]: encodeURIComponent(value.res.prompt),
    })
  })

  app.post('/v1/ai/propose-layout', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined)
    if (body === undefined) return c.json({ error: 'body is not valid JSON' }, 400)
    const parsed = LayoutProposalRequestSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)

    const usageId = await reserve(c.env, c.get('tokenHash'), 'propose-layout')
    if (usageId === null) {
      return c.json({ error: 'rate limit exceeded' }, 429, { 'retry-after': '60' })
    }
    const provider = createLlm(c.env)

    const { value, attempts } = await retryUntilValid(async () => {
      // 戻り型を信用せず検証し直すのは、実プロバイダの応答が LLM の出力をそのまま詰めたものだから
      const result = LayoutProposalResponseSchema.safeParse(
        await provider.proposeLayout(parsed.data),
      )
      return result.success ? result.data : undefined
    })
    await settleUsage(c.env.DB, usageId, attempts)

    if (value === undefined) {
      return c.json({ error: 'llm provider returned an invalid layout proposal' }, 502)
    }
    return c.json(value)
  })

  return app
}
