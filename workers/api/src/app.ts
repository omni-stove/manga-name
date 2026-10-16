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
import { type Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { createUploadApp } from './assets'
import type { Env } from './env'
import { isDecodablePng } from './png'
import { createProjectsApp } from './projects'
import {
  countMonthlyGenerations,
  monthRange,
  parseMonthlyLimit,
  reserveUsage,
  settleUsage,
  sha256Hex,
  type UsageSubject,
} from './usage'
import { DEBUG_USER_HEADER, isUserId, requireUser, type UserEnv } from './user'

/** 応答が不正なときの再試行を含めた、プロバイダを呼ぶ最大回数 */
const MAX_ATTEMPTS = 2

/** 脚本の最大文字数。LLM に渡すトークン数とその費用を 1 要求あたりで抑えるため */
const MAX_SCRIPT_LENGTH = 20_000
/** ページ数の目安の上限 */
const MAX_PAGE_COUNT = 64

/** Tauri アプリの WebView のオリジン */
const TAURI_ORIGIN = 'tauri://localhost'

/** WEB_ORIGINS と TAURI_ORIGIN */
function allowedOrigins(webOrigins: string | undefined) {
  const origins = (webOrigins ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '')
  return [...origins, TAURI_ORIGIN]
}

/** `GET /v1/usage`。当月の生成回数と上限 */
function createUsageApp(now: () => number) {
  const app = new Hono<UserEnv>()
  app.use('*', requireUser(now))
  app.get('/', async (c) => {
    const at = now()
    const limit = parseMonthlyLimit(c.env.MONTHLY_GENERATION_LIMIT)
    const generations = await countMonthlyGenerations(
      c.env.DB,
      { column: 'user_id', value: c.get('userId') },
      at,
    )
    const { start, end } = monthRange(at)
    return c.json({
      month: new Date(start).toISOString().slice(0, 7),
      generations,
      limit,
      remaining: Math.max(0, limit - generations),
      resetsAt: new Date(end).toISOString(),
    })
  })
  return app
}

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
  /** 現在時刻（Unix ミリ秒）。レート制限の窓や月の境目をテストで固定するために差し替える */
  now?: () => number
}

/** `/v1/ai/*` の認証ミドルウェアが入れる変数 */
type AiEnv = {
  Bindings: Env
  Variables: { tokenHash: string; usageSubject: UsageSubject; usageUserId: string | null }
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

/**
 * Workers の API。`GET /v1/health`、`POST /v1/ai/panel-art`、`POST /v1/ai/propose-layout`、
 * `/v1/projects` の CRUD とアセット、アセットの署名 URL の受け口 `PUT /v1/uploads/...`、`GET /v1/usage`。
 * CORS は WEB_ORIGINS と tauri://localhost だけに許す。
 */
export function createApp(options: AppOptions = {}) {
  const createImage = options.imageProvider ?? (() => createFakeImageProvider())
  const createLlm = options.llmProvider ?? (() => createFakeLlmProvider())
  const now = options.now ?? Date.now
  const app = new Hono<AiEnv>()

  app.use(
    '*',
    cors({
      origin: (origin, c) => (allowedOrigins(c.env.WEB_ORIGINS).includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['authorization', 'content-type', 'if-match', DEBUG_USER_HEADER],
      exposeHeaders: ['etag', 'location', 'retry-after', PROVIDER_HEADER, PROMPT_HEADER],
      maxAge: 600,
    }),
  )

  /**
   * ai_usage に 1 行予約し、その id を返す。月間上限なら 402、トークンの分あたり上限なら 429 の応答を返す。
   * プロバイダを呼ぶ前に呼ぶ。呼び終えてから数えると、並行する要求がすべて判定を通ってしまう
   */
  const reserve = async (c: Context<AiEnv>, kind: string): Promise<number | Response> => {
    const at = now()
    const monthlyLimit = parseMonthlyLimit(c.env.MONTHLY_GENERATION_LIMIT)
    const reservation = await reserveUsage(c.env.DB, {
      tokenHash: c.get('tokenHash'),
      userId: c.get('usageUserId'),
      subject: c.get('usageSubject'),
      kind,
      now: at,
      monthlyLimit,
    })
    if (reservation.status === 'monthly-limit') {
      return c.json(
        {
          error: 'monthly generation limit reached',
          limit: monthlyLimit,
          resetsAt: new Date(monthRange(at).end).toISOString(),
        },
        402,
      )
    }
    if (reservation.status === 'rate-limited') {
      return c.json({ error: 'rate limit exceeded' }, 429, { 'retry-after': '60' })
    }
    return reservation.id
  }

  app.get('/v1/health', (c) => c.json({ ok: true }))

  app.route('/v1/projects', createProjectsApp(now))
  app.route('/v1/uploads', createUploadApp(now))
  app.route('/v1/usage', createUsageApp(now))

  app.use('/v1/ai/*', async (c, next) => {
    const tokenHash = await authenticate(c.req.header('authorization'), c.env.APP_ACCESS_TOKEN)
    if (tokenHash === null) return c.json({ error: 'unauthorized' }, 401)
    // X-Debug-User を必須にしないのは、共有トークンだけで呼ぶ既存のクライアントを WS-14 統合まで通すため
    const userId = c.req.header(DEBUG_USER_HEADER)
    if (userId !== undefined && !isUserId(userId)) return c.json({ error: 'unauthorized' }, 401)
    c.set('tokenHash', tokenHash)
    c.set('usageUserId', userId ?? null)
    c.set(
      'usageSubject',
      userId === undefined
        ? { column: 'token_hash', value: tokenHash }
        : { column: 'user_id', value: userId },
    )
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
    const usageId = await reserve(c, 'panel-art')
    if (usageId instanceof Response) return usageId
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

    const usageId = await reserve(c, 'propose-layout')
    if (usageId instanceof Response) return usageId
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
