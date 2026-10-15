import { Hono } from 'hono'
import { z } from 'zod'
import {
  assetKey,
  deleteAsset,
  discardAsset,
  insertAsset,
  ownsProject,
  projectExists,
  readAsset,
} from './asset-store'
import { readJson } from './body'
import type { Env } from './env'
import { signUpload, type UploadClaims, verifyUpload } from './signed-url'
import type { UserEnv } from './user'

/** 1 アセットの上限（バイト） */
export const MAX_ASSET_BYTES = 20 * 1024 * 1024

/** 署名 URL の有効期間 */
export const UPLOAD_URL_TTL_MS = 15 * 60_000

/** GET でそのまま返すので、ブラウザがスクリプトとして解釈しうる型は受けない */
export const ASSET_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

const UploadUrlSchema = z.object({
  mime: z.enum(ASSET_MIME_TYPES),
  size: z.number().int().positive(),
})

const UploadQuerySchema = z.object({
  mime: z.enum(ASSET_MIME_TYPES),
  size: z.coerce.number().int().positive().max(MAX_ASSET_BYTES),
  expires: z.coerce.number().int().nonnegative(),
  sig: z.string(),
})

/**
 * `/v1/projects/:id/assets` 以下。requireUser の後ろに置き、他人のプロジェクトのアセットは 404 にする。
 * アップロードは upload-url が返す署名 URL（createUploadApp）に PUT する。
 */
export function createAssetRoutes(now: () => number) {
  const app = new Hono<UserEnv>()

  app.post('/:id/assets/upload-url', async (c) => {
    const projectId = c.req.param('id')
    const body = await readJson(c.req.raw, 1024, 'request body is too large')
    if (!body.ok) return c.json({ error: body.error }, body.status)
    const parsed = UploadUrlSchema.safeParse(body.value)
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
    if (parsed.data.size > MAX_ASSET_BYTES) return c.json({ error: 'asset exceeds 20MB' }, 413)
    if (!(await ownsProject(c.env.DB, c.get('userId'), projectId))) {
      return c.json({ error: 'not found' }, 404)
    }
    if (!c.env.ASSET_URL_SECRET) return c.json({ error: 'asset uploads are not configured' }, 500)

    const claims: UploadClaims = {
      projectId,
      assetId: crypto.randomUUID(),
      mime: parsed.data.mime,
      size: parsed.data.size,
      expires: now() + UPLOAD_URL_TTL_MS,
    }
    const url = new URL(
      `/v1/uploads/${encodeURIComponent(projectId)}/${claims.assetId}`,
      c.req.url,
    )
    url.search = new URLSearchParams({
      mime: claims.mime,
      size: String(claims.size),
      expires: String(claims.expires),
      sig: await signUpload(c.env.ASSET_URL_SECRET, claims),
    }).toString()
    return c.json({ assetId: claims.assetId, url: url.toString() })
  })

  app.get('/:id/assets/:assetId', async (c) => {
    const asset = await readAsset(
      c.env.DB,
      c.get('userId'),
      c.req.param('id'),
      c.req.param('assetId'),
    )
    // 行はアップロード前に入るので、本体がまだ無いこともある
    const object = asset && (await c.env.ASSETS.get(asset.key))
    if (!asset || !object) return c.json({ error: 'not found' }, 404)
    return c.body(object.body, 200, {
      'content-type': asset.mime,
      'content-length': String(asset.size),
      etag: object.httpEtag,
      // asset id ごとに本体は変わらない
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    })
  })

  app.delete('/:id/assets/:assetId', async (c) => {
    const key = await deleteAsset(
      c.env.DB,
      c.get('userId'),
      c.req.param('id'),
      c.req.param('assetId'),
    )
    if (key === null) return c.json({ error: 'not found' }, 404)
    await c.env.ASSETS.delete(key)
    return c.body(null, 204)
  })

  return app
}

/**
 * `PUT /v1/uploads/:projectId/:assetId?mime&size&expires&sig`。upload-url が発行した署名 URL の受け口。
 * 署名が認可を兼ねるので X-Debug-User は見ない。1 つの URL で書けるのは 1 回だけ。
 */
export function createUploadApp(now: () => number) {
  const app = new Hono<{ Bindings: Env }>()

  app.put('/:projectId/:assetId', async (c) => {
    const query = UploadQuerySchema.safeParse(c.req.query())
    if (!query.success) return c.json({ error: 'invalid upload URL' }, 403)
    const { sig, ...rest } = query.data
    const claims: UploadClaims = {
      ...rest,
      projectId: c.req.param('projectId'),
      assetId: c.req.param('assetId'),
    }
    if (!c.env.ASSET_URL_SECRET || !(await verifyUpload(c.env.ASSET_URL_SECRET, claims, sig))) {
      return c.json({ error: 'invalid upload URL' }, 403)
    }
    if (claims.expires <= now()) return c.json({ error: 'upload URL has expired' }, 403)

    const contentType = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (contentType !== claims.mime) {
      return c.json({ error: `content-type must be ${claims.mime}` }, 400)
    }
    const contentLength = c.req.header('content-length')
    if (contentLength !== undefined && Number(contentLength) !== claims.size) {
      return c.json({ error: `body must be exactly ${claims.size} bytes` }, 400)
    }
    const body = c.req.raw.body
    if (!body) return c.json({ error: `body must be exactly ${claims.size} bytes` }, 400)

    // 本体より先に行を入れるのは、同じ URL の 2 回目の PUT が書き終えた本体を上書きしないようにするため
    const inserted = await insertAsset(c.env.DB, {
      id: claims.assetId,
      projectId: claims.projectId,
      mime: claims.mime,
      size: claims.size,
      createdAt: now(),
    })
    if (inserted === 'exists') return c.json({ error: 'asset was already uploaded' }, 409)
    if (inserted === 'no-project') return c.json({ error: 'not found' }, 404)

    const key = assetKey(claims.projectId, claims.assetId)
    try {
      // 長さを固定するのは、Content-Length の無い本文でも署名した size を超えて書かせないため
      await c.env.ASSETS.put(key, body.pipeThrough(new FixedLengthStream(claims.size)), {
        httpMetadata: { contentType: claims.mime },
      })
    } catch {
      await discardAsset(c.env.DB, claims.assetId)
      return c.json({ error: `body must be exactly ${claims.size} bytes` }, 400)
    }
    // 書いている間にプロジェクトが消されると、その削除は本体を消し漏らしている
    if (!(await projectExists(c.env.DB, claims.projectId))) {
      await c.env.ASSETS.delete(key)
      return c.json({ error: 'not found' }, 404)
    }
    return c.json({ assetId: claims.assetId, mime: claims.mime, size: claims.size }, 201)
  })

  return app
}
