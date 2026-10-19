/** params の型だけを API_ERRORS に書くための印。値は使わない */
const params = <P extends Record<string, string | number>>() => ({}) as P

/**
 * workers/api が返すエラーの一覧。キーごとに HTTP ステータスと、応答に載せる値（params）の型を決める。
 * 応答の本文は ApiErrorBody で、画面に出す文言は Web がキーから引く。
 */
export const API_ERRORS = {
  unauthorized: { status: 401 },
  rate_limited: { status: 429 },
  generation_limit_reached: {
    status: 402,
    params: params<{ limit: number; resetsAt: string }>(),
  },
  invalid_request: { status: 400 },
  if_match_required: { status: 428 },
  websocket_required: { status: 426 },
  body_too_large: { status: 413 },
  project_too_large: { status: 413, params: params<{ maxBytes: number }>() },
  asset_too_large: { status: 413, params: params<{ maxBytes: number }>() },
  not_found: { status: 404 },
  edit_forbidden: { status: 403 },
  commenter_scribbles_only: { status: 403 },
  owner_only: { status: 403 },
  invite_email_mismatch: { status: 403 },
  invalid_upload_url: { status: 403 },
  upload_url_expired: { status: 403 },
  country_blocked: { status: 403 },
  conflict: { status: 409, params: params<{ updatedAt: string }>() },
  asset_already_uploaded: { status: 409 },
  asset_uploads_unavailable: { status: 500 },
  provider_invalid_response: { status: 502 },
  internal_error: { status: 500 },
} as const satisfies Record<string, { status: number; params?: Record<string, string | number> }>

export type ApiErrorCode = keyof typeof API_ERRORS

/** code の応答に載る params。持たない code は undefined */
export type ApiErrorParams<C extends ApiErrorCode> = (typeof API_ERRORS)[C] extends {
  params: infer P
}
  ? P
  : undefined

/** エラー応答の本文。code で絞り込むと params の型が決まる。detail は開発者向けの説明で、画面には出さない */
export type ApiErrorBody = {
  [C in ApiErrorCode]: { code: C; detail?: string } & (ApiErrorParams<C> extends undefined
    ? { params?: undefined }
    : { params: ApiErrorParams<C> })
}[ApiErrorCode]

const isApiErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'code' in value &&
  typeof value.code === 'string' &&
  Object.hasOwn(API_ERRORS, value.code)

/** workers/api のエラー応答を受けたときに throw する */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
    what: string,
  ) {
    super(`${what}: ${status} ${body.code}${body.detail ? ` (${body.detail})` : ''}`)
    this.name = 'ApiError'
  }
}

/** 本文が ApiErrorBody でない失敗応答（プロキシの応答など）を受けたときに throw する */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    text: string,
    what: string,
  ) {
    super(`${what}: ${status} ${text}`.trim())
    this.name = 'HttpError'
  }
}

/**
 * 失敗した応答を Error にする。本文が ApiErrorBody なら ApiError、そうでなければ本文を載せた HttpError。
 * what はメッセージの先頭に付ける、失敗した要求の説明
 */
export async function readApiError(res: Response, what: string): Promise<Error> {
  const text = await res.text().catch(() => '')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  if (isApiErrorBody(body)) return new ApiError(res.status, body, what)
  return new HttpError(res.status, text, what)
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status })

  test('an error body with a known code becomes an ApiError', async () => {
    const error = await readApiError(
      json({ code: 'conflict', params: { updatedAt: '2026-10-17T00:00:00.000Z' } }, 409),
      'PUT project',
    )
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).body).toEqual({
      code: 'conflict',
      params: { updatedAt: '2026-10-17T00:00:00.000Z' },
    })
    expect(error.message).toBe('PUT project: 409 conflict')
  })

  test('the detail goes into the message', async () => {
    const error = await readApiError(json({ code: 'invalid_request', detail: 'bad' }, 400), 'POST')
    expect(error.message).toBe('POST: 400 invalid_request (bad)')
  })

  test('an unknown code or a non-JSON body is an HttpError with the body text', async () => {
    const unknown = await readApiError(json({ code: 'nope' }, 400), 'GET')
    expect(unknown).toBeInstanceOf(HttpError)
    expect(unknown.message).toBe('GET: 400 {"code":"nope"}')

    const html = await readApiError(new Response('<h1>Bad Gateway</h1>', { status: 502 }), 'GET')
    expect(html).toBeInstanceOf(HttpError)
    expect(html.message).toBe('GET: 502 <h1>Bad Gateway</h1>')
  })
}
