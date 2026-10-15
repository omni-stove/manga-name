/** 1 トークンあたりの上限（回 / RATE_LIMIT_WINDOW_MS） */
const RATE_LIMIT = 10
const RATE_LIMIT_WINDOW_MS = 60_000

/** 文字列の SHA-256 を 16 進で返す。トークンそのものを DB に残さないために使う */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 直近 RATE_LIMIT_WINDOW_MS の行数が RATE_LIMIT 未満なら ai_usage に 1 行予約し、その id を返す。
 * 上限に達していれば null。
 * 判定と INSERT を 1 文にまとめているのは、同時に届いた要求がどれも「まだ上限前」の判定を
 * 通ってしまわないようにするため。SQLite は 1 文を他の書き込みと直列に実行する。
 * KV や Durable Object ではなく D1 を数えるのは、使用量の記録と同じ表で済ませるため。
 */
export async function reserveUsage(
  db: D1Database,
  row: { tokenHash: string; kind: string; now: number },
): Promise<number | null> {
  const { meta } = await db
    .prepare(
      `INSERT INTO ai_usage (token_hash, kind, cost_units, created_at)
       SELECT ?1, ?2, 0, ?3
       WHERE (SELECT COUNT(*) FROM ai_usage WHERE token_hash = ?1 AND created_at > ?4) < ?5`,
    )
    .bind(row.tokenHash, row.kind, row.now, row.now - RATE_LIMIT_WINDOW_MS, RATE_LIMIT)
    .run()
  return meta.changes === 1 ? meta.last_row_id : null
}

/** 予約した行に、プロバイダを呼んだ回数を cost_units として書く */
export async function settleUsage(db: D1Database, id: number, costUnits: number) {
  await db.prepare('UPDATE ai_usage SET cost_units = ?2 WHERE id = ?1').bind(id, costUnits).run()
}
