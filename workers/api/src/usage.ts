/** 1 トークンあたりの上限（回 / RATE_LIMIT_WINDOW_MS） */
const RATE_LIMIT = 10
const RATE_LIMIT_WINDOW_MS = 60_000

/**
 * 月間上限を数える単位。X-Debug-User があればユーザー、無ければ共有トークン。
 * 列名は固定の 2 択なので SQL に埋め込んでよい。
 */
export type UsageSubject =
  | { column: 'user_id'; value: string }
  | { column: 'token_hash'; value: string }

export type Reservation =
  | { status: 'reserved'; id: number }
  | { status: 'rate-limited' }
  | { status: 'monthly-limit' }

/** 文字列の SHA-256 を 16 進で返す。トークンそのものを DB に残さないために使う */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** now を含む UTC の月の初めと次の月の初め（Unix ミリ秒） */
export function monthRange(now: number): { start: number; end: number } {
  const d = new Date(now)
  return {
    start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
    end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
  }
}

/** MONTHLY_GENERATION_LIMIT を 0 以上の整数として読む。読めなければ投げる */
export function parseMonthlyLimit(value: string | undefined): number {
  const limit = Number(value)
  if (value === undefined || value.trim() === '' || !Number.isSafeInteger(limit) || limit < 0) {
    throw new Error('MONTHLY_GENERATION_LIMIT must be a non-negative integer')
  }
  return limit
}

/** subject の当月の生成回数。予約しただけの行も数える */
export async function countMonthlyGenerations(
  db: D1Database,
  subject: UsageSubject,
  now: number,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ai_usage WHERE ${subject.column} = ?1 AND created_at >= ?2`)
    .bind(subject.value, monthRange(now).start)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/**
 * トークンの直近 RATE_LIMIT_WINDOW_MS の行数が RATE_LIMIT 未満で、subject の当月の行数が
 * monthlyLimit 未満なら ai_usage に 1 行予約し、その id を返す。
 * 判定と INSERT を 1 文にまとめているのは、同時に届いた要求がどれも「まだ上限前」の判定を
 * 通ってしまわないようにするため。SQLite は 1 文を他の書き込みと直列に実行する。
 * KV や Durable Object ではなく D1 を数えるのは、使用量の記録と同じ表で済ませるため。
 */
export async function reserveUsage(
  db: D1Database,
  row: {
    tokenHash: string
    userId: string | null
    subject: UsageSubject
    kind: string
    now: number
    monthlyLimit: number
  },
): Promise<Reservation> {
  const { meta } = await db
    .prepare(
      `INSERT INTO ai_usage (token_hash, user_id, kind, cost_units, created_at)
       SELECT ?1, ?2, ?3, 0, ?4
       WHERE (SELECT COUNT(*) FROM ai_usage WHERE token_hash = ?1 AND created_at > ?5) < ?6
         AND (SELECT COUNT(*) FROM ai_usage
              WHERE ${row.subject.column} = ?7 AND created_at >= ?8) < ?9`,
    )
    .bind(
      row.tokenHash,
      row.userId,
      row.kind,
      row.now,
      row.now - RATE_LIMIT_WINDOW_MS,
      RATE_LIMIT,
      row.subject.value,
      monthRange(row.now).start,
      row.monthlyLimit,
    )
    .run()
  if (meta.changes === 1) return { status: 'reserved', id: meta.last_row_id }
  // どちらで断ったかは 1 文の結果からは分からないので数え直す。月間上限を優先して返す
  const used = await countMonthlyGenerations(db, row.subject, row.now)
  return used >= row.monthlyLimit ? { status: 'monthly-limit' } : { status: 'rate-limited' }
}

/** 予約した行に、プロバイダを呼んだ回数を cost_units として書く */
export async function settleUsage(db: D1Database, id: number, costUnits: number) {
  await db.prepare('UPDATE ai_usage SET cost_units = ?2 WHERE id = ?1').bind(id, costUnits).run()
}
