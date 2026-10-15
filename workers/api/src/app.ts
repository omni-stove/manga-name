import { createFakeImageProvider, type ImageProvider, PROMPT_HEADER, PROVIDER_HEADER } from '@manga/ai'
import { PanelArtRequestSchema } from '@manga/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from './env'
import { isDecodablePng } from './png'
import { isRateLimited, recordUsage, sha256Hex } from './usage'

/** 応答画像が不正なときの再試行を含めた、プロバイダを呼ぶ最大回数 */
const MAX_ATTEMPTS = 2

/** multipart の json 部。PanelArtRequest から Blob を除き、previous は修正指示だけにしたもの */
const PanelArtJsonSchema = PanelArtRequestSchema.omit({
  layoutPng: true,
  referencePng: true,
  characterRefs: true,
  previous: true,
}).extend({ previous: z.object({ instruction: z.string() }).optional() })

export interface AppOptions {
  /** 画像生成プロバイダ。実プロバイダの API キーは env にだけ置くので env を受け取る。既定は Fake */
  imageProvider?: (env: Env) => ImageProvider
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

const isFile = (v: unknown): v is File => typeof v !== 'string' && v !== null && v !== undefined

/** Workers のプロキシ。`GET /v1/health`、`POST /v1/ai/panel-art` */
export function createApp(options: AppOptions = {}) {
  const createProvider = options.imageProvider ?? (() => createFakeImageProvider())
  const app = new Hono<{ Bindings: Env; Variables: { tokenHash: string } }>()

  app.get('/v1/health', (c) => c.json({ ok: true }))

  app.use('/v1/ai/*', async (c, next) => {
    const tokenHash = await authenticate(c.req.header('authorization'), c.env.APP_ACCESS_TOKEN)
    if (tokenHash === null) return c.json({ error: 'unauthorized' }, 401)
    if (await isRateLimited(c.env.DB, tokenHash, Date.now())) {
      return c.json({ error: 'rate limit exceeded' }, 429, { 'retry-after': '60' })
    }
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
    const provider = createProvider(c.env)

    let attempts = 0
    let result: Awaited<ReturnType<ImageProvider['generatePanelArt']>> | undefined
    let bytes: Uint8Array | undefined
    while (attempts < MAX_ATTEMPTS && result === undefined) {
      attempts++
      try {
        const res = await provider.generatePanelArt({
          ...rest,
          layoutPng: layout,
          referencePng: isFile(referencePng) ? referencePng : undefined,
          characterRefs: characterRefs.length > 0 ? characterRefs : undefined,
          previous: previous && isFile(previousArt) ? { art: previousArt, instruction: previous.instruction } : undefined,
        })
        const candidate = new Uint8Array(await res.image.arrayBuffer())
        if (isDecodablePng(candidate)) {
          result = res
          bytes = candidate
        }
      } catch {
        // プロバイダの一時的な失敗も不正応答と同じく再試行し、使い切れば 502 にする
      }
    }

    await recordUsage(c.env.DB, {
      tokenHash: c.get('tokenHash'),
      kind: 'panel-art',
      costUnits: attempts,
      now: Date.now(),
    })

    if (result === undefined || bytes === undefined) {
      return c.json({ error: 'image provider returned an invalid image' }, 502)
    }
    return c.body(bytes, 200, {
      'content-type': 'image/png',
      [PROVIDER_HEADER]: result.provider,
      [PROMPT_HEADER]: encodeURIComponent(result.prompt),
    })
  })

  return app
}
