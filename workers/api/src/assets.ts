import { Hono } from 'hono'
import { z } from 'zod'
import { canEdit, projectRole } from './access'
import { ApiException, parseOrThrow } from './api-error'
import {
  assetIsLive,
  assetKey,
  deleteAsset,
  discardAsset,
  insertAsset,
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
const ASSET_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

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
 * `/v1/projects/:id/assets` 以下。requireUser の後ろに置き、参加していないプロジェクトのアセットは 404 にする。
 * GET は参加者なら誰でも、upload-url と DELETE は owner と editor だけができ、他は 403。
 * アップロードは upload-url が返す署名 URL（createUploadApp）に PUT する。
 */
export function createAssetRoutes(now: () => number) {
  const app = new Hono<UserEnv>()

  app.post('/:id/assets/upload-url', async (c) => {
    const projectId = c.req.param('id')
    const { mime, size } = parseOrThrow(UploadUrlSchema, await readJson(c.req.raw, 1024))
    if (size > MAX_ASSET_BYTES) {
      throw new ApiException('asset_too_large', { params: { maxBytes: MAX_ASSET_BYTES } })
    }
    const role = await projectRole(c.env.DB, c.get('userId'), projectId)
    if (role === null) throw new ApiException('not_found')
    if (!canEdit(role)) throw new ApiException('edit_forbidden')
    if (!c.env.ASSET_URL_SECRET) throw new ApiException('asset_uploads_unavailable')

    const claims: UploadClaims = {
      projectId,
      assetId: crypto.randomUUID(),
      mime,
      size,
      expires: now() + UPLOAD_URL_TTL_MS,
    }
    const url = new URL(`/v1/uploads/${encodeURIComponent(projectId)}/${claims.assetId}`, c.req.url)
    url.search = new URLSearchParams({
      mime: claims.mime,
      size: String(claims.size),
      expires: String(claims.expires),
      sig: await signUpload(c.env.ASSET_URL_SECRET, claims),
    }).toString()
    return c.json({ assetId: claims.assetId, url: url.toString() })
  })

  app.get('/:id/assets/:assetId', async (c) => {
    const projectId = c.req.param('id')
    const asset =
      (await projectRole(c.env.DB, c.get('userId'), projectId)) !== null &&
      (await readAsset(c.env.DB, projectId, c.req.param('assetId')))
    // 行はアップロード前に入るので、本体がまだ無いこともある
    const object = asset && (await c.env.ASSETS.get(asset.key))
    if (!asset || !object) throw new ApiException('not_found')
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
    const projectId = c.req.param('id')
    const role = await projectRole(c.env.DB, c.get('userId'), projectId)
    if (role === null) throw new ApiException('not_found')
    if (!canEdit(role)) throw new ApiException('edit_forbidden')
    const key = await deleteAsset(c.env.DB, projectId, c.req.param('assetId'), now())
    if (key === null) throw new ApiException('not_found')
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
    if (!query.success) throw new ApiException('invalid_upload_url')
    const { sig, ...rest } = query.data
    const claims: UploadClaims = {
      ...rest,
      projectId: c.req.param('projectId'),
      assetId: c.req.param('assetId'),
    }
    if (!c.env.ASSET_URL_SECRET || !(await verifyUpload(c.env.ASSET_URL_SECRET, claims, sig))) {
      throw new ApiException('invalid_upload_url')
    }
    if (claims.expires <= now()) throw new ApiException('upload_url_expired')

    const wrongSize = () =>
      new ApiException('invalid_request', { detail: `body must be exactly ${claims.size} bytes` })
    const contentType = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (contentType !== claims.mime) {
      throw new ApiException('invalid_request', { detail: `content-type must be ${claims.mime}` })
    }
    const contentLength = c.req.header('content-length')
    if (contentLength !== undefined && Number(contentLength) !== claims.size) throw wrongSize()
    const body = c.req.raw.body
    if (!body) throw wrongSize()

    // 本体より先に行を入れるのは、同じ URL の 2 回目の PUT が書き終えた本体を上書きしないようにするため
    const inserted = await insertAsset(c.env.DB, {
      id: claims.assetId,
      projectId: claims.projectId,
      mime: claims.mime,
      size: claims.size,
      createdAt: now(),
    })
    if (inserted === 'exists') throw new ApiException('asset_already_uploaded')
    if (inserted === 'no-project') throw new ApiException('not_found')

    const key = assetKey(claims.projectId, claims.assetId)
    try {
      // 長さを固定するのは、Content-Length の無い本文でも署名した size を超えて書かせないため
      await c.env.ASSETS.put(key, body.pipeThrough(new FixedLengthStream(claims.size)), {
        httpMetadata: { contentType: claims.mime },
      })
    } catch {
      await discardAsset(c.env.DB, claims.assetId)
      throw wrongSize()
    }
    // 書いている間にアセットかプロジェクトが消されると、その削除は本体を消し漏らしている
    if (!(await assetIsLive(c.env.DB, claims.assetId))) {
      await c.env.ASSETS.delete(key)
      throw new ApiException('not_found')
    }
    return c.json({ assetId: claims.assetId, mime: claims.mime, size: claims.size }, 201)
  })

  return app
}
