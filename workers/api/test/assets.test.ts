import { env } from 'cloudflare:workers'
import type { Project } from '@manga/schema'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../src/app'
import { MAX_ASSET_BYTES, UPLOAD_URL_TTL_MS } from '../src/assets'
import type { Env } from '../src/env'
import { isDecodablePng } from '../src/png'
import { DEBUG_USER_HEADER } from '../src/user'

let clock = Date.UTC(2026, 9, 15, 12, 0, 0)
const app = createApp({ now: () => clock })

/** 先頭に PNG のシグネチャと IHDR を置き、残りを埋めた size バイトの PNG */
function pngOfSize(size: number) {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
  bytes.set([0x49, 0x48, 0x44, 0x52, 0, 0, 0x08, 0x00, 0, 0, 0x0b, 0xb8], 12)
  for (let i = 33; i < size; i++) bytes[i] = i % 251
  return bytes
}

function call(path: string, init: { method?: string; user?: string; body?: unknown } = {}) {
  const { method = 'GET', user = 'alice', body } = init
  return app.request(
    path,
    {
      method,
      headers: {
        [DEBUG_USER_HEADER]: user,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  )
}

async function createProject(user = 'alice') {
  const res = await call('/v1/projects', { method: 'POST', user, body: { title: 'ネーム' } })
  expect(res.status).toBe(201)
  return ((await res.json()) as Project).id
}

async function uploadUrl(projectId: string, mime: string, size: number, user = 'alice') {
  const res = await call(`/v1/projects/${projectId}/assets/upload-url`, {
    method: 'POST',
    user,
    body: { mime, size },
  })
  return { res, ...((res.ok ? await res.json() : {}) as { assetId?: string; url?: string }) }
}

/** バイト列の本文には実際のクライアントと同じく Content-Length を付け、ストリームの本文には付けない */
function upload(
  url: string,
  body: Uint8Array | ReadableStream,
  contentType = 'image/png',
  bindings: Env = env,
) {
  // workerd の Request はバイト列の本文から Content-Length ヘッダを作らない
  const headers: Record<string, string> = { 'content-type': contentType }
  if (body instanceof Uint8Array) headers['content-length'] = String(body.byteLength)
  return app.request(url, { method: 'PUT', headers, body }, bindings)
}

/**
 * put に渡された本文を読み切ってから R2 に書く ASSETS を持つ env。
 * 本文が途中で失敗する PUT はこれで送る。miniflare の R2 シミュレータは途中で失敗した本文を受けると、
 * 本番の R2 と同じく put を reject させたうえで、シミュレータ側の isolate でも Uncaught (in promise) を
 * workerd のログに出す。本文を先に読み切れば、同じ失敗が R2 に届く前に put の reject として起きる。
 */
function envReadingBodyBeforeR2(): Env {
  const assets = new Proxy(env.ASSETS, {
    get(target, prop) {
      if (prop === 'put') {
        return async (key: string, value: Parameters<R2Bucket['put']>[1], options?: R2PutOptions) =>
          target.put(
            key,
            value instanceof ReadableStream ? await new Response(value).arrayBuffer() : value,
            options,
          )
      }
      const member = Reflect.get(target, prop)
      return typeof member === 'function' ? member.bind(target) : member
    },
  })
  return { ...env, ASSETS: assets }
}

async function issue(projectId: string, size: number) {
  const { res, assetId, url } = await uploadUrl(projectId, 'image/png', size)
  expect(res.status).toBe(200)
  if (!assetId || !url) throw new Error('upload-url returned no url')
  return { assetId, url }
}

const objectCount = async () => (await env.ASSETS.list()).objects.length

beforeEach(async () => {
  clock = Date.UTC(2026, 9, 15, 12, 0, 0)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits'),
    env.DB.prepare('DELETE FROM assets'),
    env.DB.prepare('DELETE FROM project_doc_chunks'),
    env.DB.prepare('DELETE FROM projects'),
    env.DB.prepare('DELETE FROM users'),
  ])
  const { objects } = await env.ASSETS.list()
  if (objects.length > 0) await env.ASSETS.delete(objects.map((o) => o.key))
})

describe('asset upload with a signed URL', () => {
  test('uploads a 10MB PNG and GETs the same bytes back', async () => {
    const projectId = await createProject()
    const png = pngOfSize(10 * 1024 * 1024)
    const { assetId, url } = await issue(projectId, png.byteLength)
    expect(new URL(url).pathname).toBe(`/v1/uploads/${projectId}/${assetId}`)

    const put = await upload(url, png)
    expect(put.status).toBe(201)
    expect(await put.json()).toEqual({ assetId, mime: 'image/png', size: png.byteLength })

    const got = await call(`/v1/projects/${projectId}/assets/${assetId}`)
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(got.headers.get('content-length')).toBe(String(png.byteLength))
    expect(got.headers.get('x-content-type-options')).toBe('nosniff')
    const bytes = new Uint8Array(await got.arrayBuffer())
    expect(bytes.byteLength).toBe(png.byteLength)
    expect(isDecodablePng(bytes)).toBe(true)
    const digest = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b))
    expect(await digest(bytes)).toEqual(await digest(png))
    expect((await env.ASSETS.head(`${projectId}/${assetId}`))?.size).toBe(png.byteLength)
  })

  test('accepts a body without Content-Length of exactly the signed size', async () => {
    const projectId = await createProject()
    const png = pngOfSize(1024)
    const { url } = await issue(projectId, png.byteLength)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(png.subarray(0, 512))
        controller.enqueue(png.subarray(512))
        controller.close()
      },
    })
    expect((await upload(url, stream)).status).toBe(201)
  })

  test('the URL can be used only once', async () => {
    const projectId = await createProject()
    const png = pngOfSize(1024)
    const { url } = await issue(projectId, png.byteLength)
    expect((await upload(url, png)).status).toBe(201)
    expect((await upload(url, pngOfSize(1024).fill(7, 33))).status).toBe(409)
  })

  test('403 when the signature, size or mime in the URL is altered', async () => {
    const projectId = await createProject()
    const { url } = await issue(projectId, 1024)
    const tamper = (key: string, value: string) => {
      const u = new URL(url)
      u.searchParams.set(key, value)
      return u.toString()
    }
    expect((await upload(tamper('sig', '0'.repeat(64)), pngOfSize(1024))).status).toBe(403)
    expect((await upload(tamper('size', '2048'), pngOfSize(2048))).status).toBe(403)
    expect((await upload(tamper('mime', 'image/jpeg'), pngOfSize(1024), 'image/jpeg')).status).toBe(
      403,
    )
    const other = new URL(url)
    other.pathname = other.pathname.replace(/[^/]+$/, crypto.randomUUID())
    expect((await upload(other.toString(), pngOfSize(1024))).status).toBe(403)
    expect(await objectCount()).toBe(0)
  })

  test('403 after the URL expires', async () => {
    const projectId = await createProject()
    const { url } = await issue(projectId, 1024)
    clock += UPLOAD_URL_TTL_MS
    expect((await upload(url, pngOfSize(1024))).status).toBe(403)
  })

  test('400 on a different content-type or body size, and the URL stays usable', async () => {
    const projectId = await createProject()
    const { assetId, url } = await issue(projectId, 1024)
    expect((await upload(url, pngOfSize(1024), 'text/html')).status).toBe(400)
    expect((await upload(url, pngOfSize(1023))).status).toBe(400)
    expect((await upload(url, pngOfSize(1025))).status).toBe(400)
    for (const size of [1000, 1025]) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(pngOfSize(size))
          controller.close()
        },
      })
      expect((await upload(url, stream, 'image/png', envReadingBodyBeforeR2())).status).toBe(400)
    }
    expect((await call(`/v1/projects/${projectId}/assets/${assetId}`)).status).toBe(404)

    expect((await upload(url, pngOfSize(1024))).status).toBe(201)
  })

  test('404 when the project was deleted before the upload', async () => {
    const projectId = await createProject()
    const { url } = await issue(projectId, 1024)
    expect((await call(`/v1/projects/${projectId}`, { method: 'DELETE' })).status).toBe(204)
    expect((await upload(url, pngOfSize(1024))).status).toBe(404)
    expect(await objectCount()).toBe(0)
  })
})

describe('POST /v1/projects/:id/assets/upload-url', () => {
  test('413 over 20MB, 400 on an unsupported mime or a bad size', async () => {
    const projectId = await createProject()
    expect((await uploadUrl(projectId, 'image/png', MAX_ASSET_BYTES)).res.status).toBe(200)
    expect((await uploadUrl(projectId, 'image/png', MAX_ASSET_BYTES + 1)).res.status).toBe(413)
    expect((await uploadUrl(projectId, 'text/html', 1024)).res.status).toBe(400)
    expect((await uploadUrl(projectId, 'image/png', 0)).res.status).toBe(400)
    expect((await uploadUrl(projectId, 'image/png', 1.5)).res.status).toBe(400)
  })

  test('404 for another user’s project and 401 without a user', async () => {
    const projectId = await createProject()
    expect((await uploadUrl(projectId, 'image/png', 1024, 'bob')).res.status).toBe(404)
    const res = await app.request(
      `/v1/projects/${projectId}/assets/upload-url`,
      { method: 'POST', body: JSON.stringify({ mime: 'image/png', size: 1024 }) },
      env,
    )
    expect(res.status).toBe(401)
  })
})

describe('GET and DELETE /v1/projects/:id/assets/:assetId', () => {
  test('only the owner can read or delete, and DELETE removes the object', async () => {
    const projectId = await createProject()
    const { assetId, url } = await issue(projectId, 1024)
    expect((await upload(url, pngOfSize(1024))).status).toBe(201)
    const path = `/v1/projects/${projectId}/assets/${assetId}`

    expect((await call(path, { user: 'bob' })).status).toBe(404)
    expect((await call(path, { method: 'DELETE', user: 'bob' })).status).toBe(404)

    expect((await call(path, { method: 'DELETE' })).status).toBe(204)
    expect((await call(path)).status).toBe(404)
    expect(await objectCount()).toBe(0)
    expect((await call(path, { method: 'DELETE' })).status).toBe(404)
  })

  test('a deleted asset cannot be uploaded again with the same URL', async () => {
    const projectId = await createProject()
    const { assetId, url } = await issue(projectId, 1024)
    expect((await upload(url, pngOfSize(1024))).status).toBe(201)
    const path = `/v1/projects/${projectId}/assets/${assetId}`
    expect((await call(path, { method: 'DELETE' })).status).toBe(204)

    expect((await upload(url, pngOfSize(1024))).status).toBe(409)
    expect((await call(path)).status).toBe(404)
    expect(await objectCount()).toBe(0)
  })

  test('an asset deleted while its body is being uploaded leaves no object behind', async () => {
    const projectId = await createProject()
    const { assetId, url } = await issue(projectId, 1024)
    const png = pngOfSize(1024)
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(png.subarray(0, 512))
        await released
        controller.enqueue(png.subarray(512))
        controller.close()
      },
    })
    const put = upload(url, body)
    // 行は本体より先に入るので、行が見えたら PUT は本体を書いている途中
    const rowExists = () =>
      env.DB.prepare('SELECT 1 AS found FROM assets WHERE id = ?1').bind(assetId).first()
    while ((await rowExists()) === null) await new Promise((r) => setTimeout(r, 5))
    const path = `/v1/projects/${projectId}/assets/${assetId}`
    expect((await call(path, { method: 'DELETE' })).status).toBe(204)
    release()

    expect((await put).status).toBe(404)
    expect((await call(path)).status).toBe(404)
    expect(await objectCount()).toBe(0)
  })

  test('404 for an asset of another project of the same owner', async () => {
    const first = await createProject()
    const second = await createProject()
    const { assetId, url } = await issue(first, 1024)
    expect((await upload(url, pngOfSize(1024))).status).toBe(201)
    expect((await call(`/v1/projects/${second}/assets/${assetId}`)).status).toBe(404)
  })

  test('deleting the project removes its assets', async () => {
    const projectId = await createProject()
    const kept = await createProject()
    for (const id of [projectId, projectId, kept]) {
      const { url } = await issue(id, 1024)
      expect((await upload(url, pngOfSize(1024))).status).toBe(201)
    }
    expect((await call(`/v1/projects/${projectId}`, { method: 'DELETE' })).status).toBe(204)
    const { objects } = await env.ASSETS.list()
    expect(objects.map((o) => o.key.split('/')[0])).toEqual([kept])
    const rows = await env.DB.prepare('SELECT project_id FROM assets').all<{ project_id: string }>()
    expect(rows.results).toEqual([{ project_id: kept }])
  })
})
