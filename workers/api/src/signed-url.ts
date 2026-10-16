/** 署名 URL で 1 回の PUT に許す内容。URL のクエリにそのまま載り、改ざんは署名で検出する */
export interface UploadClaims {
  projectId: string
  assetId: string
  mime: string
  size: number
  /** 失効時刻（Unix ミリ秒） */
  expires: number
}

const encoder = new TextEncoder()

const SIGNATURE = /^[0-9a-f]{64}$/

function importKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

const canonical = (claims: UploadClaims) =>
  encoder.encode(
    ['PUT', claims.projectId, claims.assetId, claims.mime, claims.size, claims.expires].join('\n'),
  )

/** claims の HMAC-SHA256 を 16 進で返す */
export async function signUpload(secret: string, claims: UploadClaims): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await importKey(secret), canonical(claims))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** signature が claims に対する signUpload の結果と一致すれば true */
export async function verifyUpload(
  secret: string,
  claims: UploadClaims,
  signature: string,
): Promise<boolean> {
  if (!SIGNATURE.test(signature)) return false
  const bytes = new Uint8Array(signature.match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? [])
  // 文字列比較ではなく verify にするのは、一致した桁数を応答時間から推測させないため
  return crypto.subtle.verify('HMAC', await importKey(secret), bytes, canonical(claims))
}
