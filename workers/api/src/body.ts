import { ApiException } from './api-error'

const notJson = () => new ApiException('invalid_request', { detail: 'body is not valid JSON' })

/**
 * 要求の本文を maxBytes まで読んで JSON として解釈する。超えれば tooLarge を、JSON でなければ invalid_request を throw する。
 * tooLarge を渡さなければ body_too_large
 */
export async function readJson(
  request: Request,
  maxBytes: number,
  tooLarge: ApiException = new ApiException('body_too_large'),
): Promise<unknown> {
  // Content-Length で先に断るのは、上限を大きく超える本文をメモリに読み込まないため
  if (Number(request.headers.get('content-length')) > maxBytes) throw tooLarge
  // Content-Length の無い chunked 本文でも上限を超えた時点で読むのをやめるため、ストリームで読む
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = request.body?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw tooLarge
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(body))
  } catch {
    throw notJson()
  }
}

/** 大きさを別に抑えた要求（bodyLimit の後ろなど）の本文を JSON として読む。JSON でなければ invalid_request を throw する */
export const requestJson = (request: Request): Promise<unknown> =>
  request.json().catch(() => {
    throw notJson()
  })
