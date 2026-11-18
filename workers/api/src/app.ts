import {
  createFakeImageProvider,
  createFakeLlmProvider,
  type ImageProvider,
  type LlmProvider,
  MAX_PAGE_COUNT,
  type PanelArtResponse,
  PROMPT_HEADER,
  PROVIDER_HEADER,
} from '@manga/ai'
import {
  CharacterArtRequestSchema,
  MAX_NAME_PANELS,
  type NamePanel,
  NamePanelSchema,
  PageArtRequestSchema,
  PageDiagnosisSchema,
  PageSchema,
  PanelActingSchema,
  PanelArtRequestSchema,
  type PlanLine,
  ProjectBaseSchema,
} from '@manga/schema'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { ApiException, handleError, parseOrThrow } from './api-error'
import { createUploadApp } from './assets'
import { AUTH_BASE_PATH, getAuth } from './auth'
import { requestJson } from './body'
import { createDesktopSignInApp } from './desktop-sign-in'
import type { Env } from './env'
import { requireAllowedCountry } from './geo'
import { createMeApp } from './me'
import { createInviteApp } from './members'
import { allowedOrigins } from './origins'
import { isDecodablePng } from './png'
import { createProjectsApp } from './projects'
import {
  countMonthlyGenerations,
  monthRange,
  parseMonthlyLimit,
  reserveUsage,
  settleUsage,
} from './usage'
import { DEBUG_USER_HEADER, requireUser, type UserEnv } from './user'

/** 応答が不正なときの再試行を含めた、プロバイダを呼ぶ最大回数 */
const MAX_ATTEMPTS = 2

/** 脚本の最大文字数。LLM に渡すトークン数とその費用を 1 要求あたりで抑えるため */
const MAX_SCRIPT_LENGTH = 20_000
const MAX_NAME_TEXT_LENGTH = 2_000
const MAX_NAME_LINES = 50
const MAX_NAME_ACTING = 20
/** ネームの書き起こしに添える、ページに今あるコマの数の上限。LLM に渡すトークン数を抑えるため */
const MAX_CURRENT_PANELS = 30
/**
 * critique の本文の上限。ページの JSON は手描きの線や絵の履歴で際限なく膨らむので、
 * LLM に渡すトークン数を抑えるため本文の大きさで切る。Web は線と絵を外して送る
 */
const MAX_CRITIQUE_BODY_BYTES = 256 * 1024

/** `GET /v1/usage`。当月の生成回数と上限 */
function createUsageApp(now: () => number) {
  const app = new Hono<UserEnv>()
  app.use('*', requireUser(now))
  app.get('/', async (c) => {
    const at = now()
    const limit = parseMonthlyLimit(c.env.MONTHLY_GENERATION_LIMIT)
    const generations = await countMonthlyGenerations(c.env.DB, c.get('userId'), at)
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

/** page-art の multipart の json 部。PageArtRequest から Blob を除いたもの */
const PageArtJsonSchema = PageArtRequestSchema.omit({
  layoutPng: true,
  referencePng: true,
  characterRefs: true,
})

/** `@manga/ai` の PagePlanRequest */
const PagePlanRequestSchema = z.object({
  project: ProjectBaseSchema.pick({ settings: true, characters: true }),
  script: z.string().trim().min(1).max(MAX_SCRIPT_LENGTH),
  pageCount: z.number().int().min(1).max(MAX_PAGE_COUNT).optional(),
})

const ActingRequestSchema = z
  .array(PanelActingSchema.extend({ text: z.string().min(1).max(MAX_NAME_TEXT_LENGTH) }))
  .max(MAX_NAME_ACTING)

/** `@manga/ai` の NameDraftRequest */
const NameDraftRequestSchema = z.object({
  project: ProjectBaseSchema.pick({ settings: true, characters: true }),
  script: z.string().trim().min(1).max(MAX_SCRIPT_LENGTH),
  current: z
    .array(
      z.object({
        note: z.string().max(MAX_NAME_TEXT_LENGTH).optional(),
        acting: ActingRequestSchema,
      }),
    )
    .max(MAX_CURRENT_PANELS)
    .optional(),
})

/** `@manga/ai` の LayoutSuggestionRequest */
const LayoutSuggestionRequestSchema = z.object({
  panels: z
    .array(
      NamePanelSchema.extend({
        note: z.string().min(1).max(MAX_NAME_TEXT_LENGTH),
        lines: z
          .array(
            NamePanelSchema.shape.lines.element.extend({
              text: z.string().min(1).max(MAX_NAME_TEXT_LENGTH),
            }),
          )
          .max(MAX_NAME_LINES),
        acting: ActingRequestSchema.optional(),
      }),
    )
    .min(1)
    .max(MAX_NAME_PANELS),
})

/** `@manga/ai` の CritiqueRequest。診断は同じページのものに限る */
const CritiqueRequestSchema = z
  .object({ page: PageSchema, diagnosis: PageDiagnosisSchema })
  .refine((req) => req.diagnosis.pageId === req.page.id, {
    message: 'diagnosis.pageId does not match page.id',
    path: ['diagnosis', 'pageId'],
  })

export interface AppOptions {
  /** 画像生成プロバイダ。実プロバイダの API キーは env にだけ置くので env を受け取る。既定は Fake */
  imageProvider?: (env: Env) => ImageProvider
  /** LLM プロバイダ。env を受け取る理由は imageProvider と同じ。既定は Fake */
  llmProvider?: (env: Env) => LlmProvider
  /** 現在時刻（Unix ミリ秒）。レート制限の窓や月の境目をテストで固定するために差し替える */
  now?: () => number
}

/**
 * call を最大 MAX_ATTEMPTS 回呼び、最初に undefined 以外を返した値と、呼んだ回数を返す。
 * 使い切れば value は undefined。call の throw も不正応答と同じ失敗として数え、`kind` を添えてログに出す。
 */
async function retryUntilValid<T>(
  kind: string,
  call: () => Promise<T | undefined>,
): Promise<{ value: T | undefined; attempts: number }> {
  let attempts = 0
  while (attempts < MAX_ATTEMPTS) {
    attempts++
    try {
      const value = await call()
      if (value !== undefined) return { value, attempts }
    } catch (e) {
      // プロバイダの一時的な失敗も不正応答と同じく再試行し、使い切れば 502 にする
      console.error(`${kind}: provider call failed on attempt ${attempts}`, e)
    }
  }
  return { value: undefined, attempts }
}

/** characterIds に居ない話し手を落とす。居ない話し手はプロジェクトのスキーマを通らないため */
function dropUnknownSpeakers(lines: PlanLine[], characterIds: ReadonlySet<string>): PlanLine[] {
  return lines.map(({ speakerId, ...line }) =>
    speakerId !== undefined && characterIds.has(speakerId) ? { ...line, speakerId } : line,
  )
}

/**
 * 居ないキャラの芝居と、同じキャラの 2 つ目からの芝居を落とす。
 * セリフと違ってキャラの無い芝居は Panel.acting に置けず、Panel.acting はキャラごとに 1 つなので作り直させずに捨てる
 */
function dropUnknownActing(
  acting: NonNullable<NamePanel['acting']>,
  characterIds: ReadonlySet<string>,
): NonNullable<NamePanel['acting']> {
  return acting.filter(
    (a, i) =>
      characterIds.has(a.characterId) &&
      acting.findIndex((b) => b.characterId === a.characterId) === i,
  )
}

const isFile = (v: unknown): v is File => typeof v !== 'string' && v !== null && v !== undefined

/**
 * 画像生成の multipart を読む。json 部を schema で検証し、layout と reference と character_<id> を取り出す。
 * 欠けや不正は invalid_request を throw する
 */
async function readImageForm<S extends z.ZodType>(c: Context<UserEnv>, schema: S) {
  const form = await c.req.formData().catch(() => null)
  const rawJson = form?.get('json')
  const layout = form?.get('layout')
  if (!form || typeof rawJson !== 'string' || !isFile(layout)) {
    throw new ApiException('invalid_request', { detail: 'json and layout are required' })
  }
  let json: unknown
  try {
    json = JSON.parse(rawJson)
  } catch {
    throw new ApiException('invalid_request', { detail: 'json is not valid JSON' })
  }
  const reference = form.get('reference')
  const characterRefs = [...form.entries()].flatMap(([key, value]) =>
    key.startsWith('character_') && isFile(value)
      ? [{ characterId: key.slice('character_'.length), image: value }]
      : [],
  )
  return {
    form,
    json: parseOrThrow(schema, json),
    layoutPng: layout,
    referencePng: isFile(reference) ? reference : undefined,
    characterRefs: characterRefs.length > 0 ? characterRefs : undefined,
  }
}

/**
 * Workers の API。`GET /v1/health`、Better Auth の `/v1/auth/*`、Desktop のログインの口 `/v1/desktop-sign-in`、`POST /v1/ai/panel-art`、`POST /v1/ai/page-art`、`POST /v1/ai/character-art`、`POST /v1/ai/plan-pages`、`POST /v1/ai/transcribe-name`、`POST /v1/ai/suggest-layout`、`POST /v1/ai/critique`、
 * `/v1/projects` の CRUD とアセットと参加者、招待リンクの受け口 `/v1/invites/:token`、アセットの署名 URL の受け口 `PUT /v1/uploads/...`、`GET /v1/usage`。
 * `/v1/health`、`/v1/auth/*`、`/v1/desktop-sign-in`、`/v1/uploads` 以外は requireUser で Bearer トークンを検証する。
 * CORS は WEB_ORIGINS と Tauri の WebView のオリジン（tauri://localhost と http://tauri.localhost）だけに許す。`/v1/health` 以外は ALLOWED_COUNTRIES の国からの接続だけを通す。
 */
export function createApp(options: AppOptions = {}) {
  const createImage = options.imageProvider ?? (() => createFakeImageProvider())
  const createLlm = options.llmProvider ?? (() => createFakeLlmProvider())
  const now = options.now ?? Date.now
  const app = new Hono<UserEnv>()

  app.use(
    '*',
    cors({
      origin: (origin, c) => (allowedOrigins(c.env.WEB_ORIGINS).includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['authorization', 'content-type', 'if-match', DEBUG_USER_HEADER],
      exposeHeaders: [
        'etag',
        'location',
        'retry-after',
        'set-auth-token',
        PROVIDER_HEADER,
        PROMPT_HEADER,
      ],
      // Google OAuth の state を Cookie で持つので、Better Auth の口には資格情報付きで来る
      credentials: true,
      maxAge: 600,
    }),
  )

  /**
   * ai_usage に 1 行予約し、その id を返す。月間上限なら generation_limit_reached、トークンの分あたり上限なら
   * rate_limited を throw する。
   * プロバイダを呼ぶ前に呼ぶ。呼び終えてから数えると、並行する要求がすべて判定を通ってしまう
   */
  const reserve = async (c: Context<UserEnv>, kind: string): Promise<number> => {
    const at = now()
    const monthlyLimit = parseMonthlyLimit(c.env.MONTHLY_GENERATION_LIMIT)
    const reservation = await reserveUsage(c.env.DB, {
      userId: c.get('userId'),
      kind,
      now: at,
      monthlyLimit,
    })
    if (reservation.status === 'monthly-limit') {
      throw new ApiException('generation_limit_reached', {
        params: { limit: monthlyLimit, resetsAt: new Date(monthRange(at).end).toISOString() },
      })
    }
    if (reservation.status === 'rate-limited') {
      throw new ApiException('rate_limited', { headers: { 'retry-after': '60' } })
    }
    return reservation.id
  }

  app.onError(handleError)

  // GitHub Actions の runner は海外にあり、デプロイ後のヘルスチェックを通すため health だけは国で弾かない
  app.get('/v1/health', (c) => c.json({ ok: true }))

  app.use('*', requireAllowedCountry())

  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) => getAuth(c.env).handler(c.req.raw))

  app.route('/v1/desktop-sign-in', createDesktopSignInApp())
  app.route('/v1/projects', createProjectsApp(now))
  app.route('/v1/me', createMeApp(now))
  app.route('/v1/invites', createInviteApp(now))
  app.route('/v1/uploads', createUploadApp(now))
  app.route('/v1/usage', createUsageApp(now))

  app.use('/v1/ai/*', requireUser(now))

  /** 画像を返す生成の共通の後半。1 回予約し、PNG として読めるまで再試行して、プロバイダを呼んだ回数を記録する */
  const respondImage = async (
    c: Context<UserEnv>,
    kind: string,
    call: (provider: ImageProvider) => Promise<PanelArtResponse>,
  ) => {
    const usageId = await reserve(c, kind)
    const provider = createImage(c.env)

    const { value, attempts } = await retryUntilValid(kind, async () => {
      const res = await call(provider)
      const bytes = new Uint8Array(await res.image.arrayBuffer())
      if (isDecodablePng(bytes)) return { res, bytes }
      console.error(`${kind}: provider returned an image that is not a decodable PNG`)
      return undefined
    })
    await settleUsage(c.env.DB, usageId, attempts)

    if (value === undefined) {
      throw new ApiException('provider_invalid_response', {
        detail: 'image provider returned an invalid image',
      })
    }
    return c.body(value.bytes, 200, {
      'content-type': 'image/png',
      [PROVIDER_HEADER]: value.res.provider,
      [PROMPT_HEADER]: encodeURIComponent(value.res.prompt),
    })
  }

  app.post('/v1/ai/panel-art', async (c) => {
    const { form, json, ...images } = await readImageForm(c, PanelArtJsonSchema)
    const { previous, ...rest } = json
    const previousArt = form.get('previous')
    if (previous && !isFile(previousArt)) {
      throw new ApiException('invalid_request', {
        detail: 'previous image is required with previous.instruction',
      })
    }
    return respondImage(c, 'panel-art', (provider) =>
      provider.generatePanelArt({
        ...rest,
        ...images,
        previous:
          previous && isFile(previousArt)
            ? { art: previousArt, instruction: previous.instruction }
            : undefined,
      }),
    )
  })

  // ページ 1 枚を 1 回の生成として数える。コマへの切り抜きは Web がする
  app.post('/v1/ai/page-art', async (c) => {
    const { json, layoutPng, referencePng, characterRefs } = await readImageForm(
      c,
      PageArtJsonSchema,
    )
    return respondImage(c, 'page-art', (provider) =>
      provider.generatePageArt({ ...json, layoutPng, referencePng, characterRefs }),
    )
  })

  app.post('/v1/ai/character-art', async (c) => {
    const req = parseOrThrow(CharacterArtRequestSchema, await requestJson(c.req.raw))
    return respondImage(c, 'character-art', (provider) => provider.generateCharacterArt(req))
  })

  app.post('/v1/ai/plan-pages', async (c) => {
    const req = parseOrThrow(PagePlanRequestSchema, await requestJson(c.req.raw))
    const usageId = await reserve(c, 'plan-pages')
    const provider = createLlm(c.env)
    const characterIds = new Set(req.project.characters.map((ch) => ch.id))

    const { value, attempts } = await retryUntilValid('plan-pages', async () => {
      const plan = await provider.planPages(req)
      if (plan.length > MAX_PAGE_COUNT) {
        console.error(`plan-pages: ${plan.length} pages exceed ${MAX_PAGE_COUNT}`)
        return undefined
      }
      // 指定とのページ数のずれと居ないキャラは作り直させない。ページ数が多いとモデルは再試行してもずれがちで、
      // ずれは Web が警告して利用者に直させる。居ないキャラは登場キャラと話し手がスキーマを通らなくなるので落とす
      return plan.map((p) => ({
        ...p,
        cast: p.cast.filter((id, i) => p.cast.indexOf(id) === i && characterIds.has(id)),
        lines: dropUnknownSpeakers(p.lines, characterIds),
      }))
    })
    await settleUsage(c.env.DB, usageId, attempts)

    if (value === undefined) {
      throw new ApiException('provider_invalid_response', {
        detail: 'llm provider returned an invalid page plan',
      })
    }
    return c.json(value)
  })

  app.post('/v1/ai/transcribe-name', async (c) => {
    const req = parseOrThrow(NameDraftRequestSchema, await requestJson(c.req.raw))
    const usageId = await reserve(c, 'transcribe-name')
    const provider = createLlm(c.env)
    const characterIds = new Set(req.project.characters.map((ch) => ch.id))

    const { value, attempts } = await retryUntilValid('transcribe-name', async () => {
      const name = await provider.transcribeName(req)
      return {
        panels: name.panels.map(({ acting, ...panel }) => {
          const known = dropUnknownActing(acting ?? [], characterIds)
          return {
            ...panel,
            lines: dropUnknownSpeakers(panel.lines, characterIds),
            ...(known.length > 0 && { acting: known }),
          }
        }),
      }
    })
    await settleUsage(c.env.DB, usageId, attempts)

    if (value === undefined) {
      throw new ApiException('provider_invalid_response', {
        detail: 'llm provider returned an invalid name',
      })
    }
    return c.json(value)
  })

  app.post('/v1/ai/suggest-layout', async (c) => {
    const req = parseOrThrow(LayoutSuggestionRequestSchema, await requestJson(c.req.raw))
    const usageId = await reserve(c, 'suggest-layout')
    const provider = createLlm(c.env)

    const { value, attempts } = await retryUntilValid('suggest-layout', async () => {
      const suggestion = await provider.suggestLayout(req)
      // Web は案のコマを読む順にネームのコマへ当てるので、数の合わない案は落とし、1 つも残らなければ作り直させる
      const options = suggestion.options.filter(
        (option) => option.rows.reduce((n, row) => n + row.panels.length, 0) === req.panels.length,
      )
      if (options.length === 0) {
        console.error(`suggest-layout: no option has ${req.panels.length} panels`)
        return undefined
      }
      return { options }
    })
    await settleUsage(c.env.DB, usageId, attempts)

    if (value === undefined) {
      throw new ApiException('provider_invalid_response', {
        detail: 'llm provider returned an invalid layout suggestion',
      })
    }
    return c.json(value)
  })

  // 提案の Patch が許された操作だけかはここで見ない。拒否した提案も警告つきで利用者に見せるため、Web が適用の前に検査する
  app.post(
    '/v1/ai/critique',
    bodyLimit({
      maxSize: MAX_CRITIQUE_BODY_BYTES,
      onError: () => {
        throw new ApiException('body_too_large')
      },
    }),
    async (c) => {
      const req = parseOrThrow(CritiqueRequestSchema, await requestJson(c.req.raw))

      const usageId = await reserve(c, 'critique')
      const provider = createLlm(c.env)

      const { value, attempts } = await retryUntilValid('critique', () => provider.critique(req))
      await settleUsage(c.env.DB, usageId, attempts)

      if (value === undefined) {
        throw new ApiException('provider_invalid_response', {
          detail: 'llm provider returned an invalid critique',
        })
      }
      return c.json(value)
    },
  )

  return app
}
