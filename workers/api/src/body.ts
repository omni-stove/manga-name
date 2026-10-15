export type JsonBody =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string }

/** 要求の本文を maxBytes まで読んで JSON として解釈する。超えれば 413 と tooLargeError */
export async function readJson(
  request: Request,
  maxBytes: number,
  tooLargeError: string,
): Promise<JsonBody> {
  const tooLarge = { ok: false, status: 413, error: tooLargeError } as const
  // Content-Length で先に断るのは、上限を大きく超える本文をメモリに読み込まないため
  if (Number(request.headers.get('content-length')) > maxBytes) return tooLarge
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
      return tooLarge
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
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) }
  } catch {
    return { ok: false, status: 400, error: 'body is not valid JSON' }
  }
}
