/** 1 トークンあたりの上限（回 / RATE_LIMIT_WINDOW_MS） */
export const RATE_LIMIT = 10
export const RATE_LIMIT_WINDOW_MS = 60_000

/** 文字列の SHA-256 を 16 進で返す。トークンそのものを DB に残さないために使う */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * ai_usage の直近 RATE_LIMIT_WINDOW_MS の行数でレート制限を判定する。
 * KV や Durable Object ではなく D1 を数えるのは、使用量の記録と同じ表で済ませるため。
 */
export async function isRateLimited(db: D1Database, tokenHash: string, now: number) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE token_hash = ?1 AND created_at > ?2')
    .bind(tokenHash, now - RATE_LIMIT_WINDOW_MS)
    .first<{ n: number }>()
  return (row?.n ?? 0) >= RATE_LIMIT
}

/** 利用量を 1 行記録する。cost_units はプロバイダを呼んだ回数 */
export async function recordUsage(
  db: D1Database,
  row: { tokenHash: string; kind: string; costUnits: number; now: number },
) {
  await db
    .prepare('INSERT INTO ai_usage (token_hash, kind, cost_units, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(row.tokenHash, row.kind, row.costUnits, row.now)
    .run()
}
