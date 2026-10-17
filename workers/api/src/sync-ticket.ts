import { createMiddleware } from 'hono/factory'
import { ApiException } from './api-error'
import { hashToken, newToken } from './token'
import { requireUser, type UserEnv } from './user'

/** 同期の接続チケットの有効期間。発行してすぐ WebSocket を開くので、URL がログに残っても使えないよう短くする */
export const SYNC_TICKET_TTL_MS = 30_000

/** `GET /v1/projects/:id/sync` のチケットを渡すクエリ */
const SYNC_TICKET_PARAM = 'ticket'

/** userId が projectId の同期に 1 回だけつなげるチケットを発行する。期限切れのチケットはここで消す */
export async function issueSyncTicket(
  db: D1Database,
  projectId: string,
  userId: string,
  now: number,
): Promise<{ ticket: string; expiresAt: number }> {
  const ticket = newToken()
  const expiresAt = now + SYNC_TICKET_TTL_MS
  await db.batch([
    db.prepare('DELETE FROM sync_tickets WHERE expires_at <= ?1').bind(now),
    db
      .prepare(
        'INSERT INTO sync_tickets (token_hash, project_id, user_id, expires_at) VALUES (?1, ?2, ?3, ?4)',
      )
      .bind(await hashToken(ticket), projectId, userId, expiresAt),
  ])
  return { ticket, expiresAt }
}

/**
 * projectId のチケットを消費し、発行したユーザーの id を返す。無い、別のプロジェクトのもの、期限切れなら null。
 * 読んでから消すのでなく 1 文の DELETE ... RETURNING にするのは、同じチケットで同時に来た 2 本を両方通さないため
 */
async function consumeSyncTicket(
  db: D1Database,
  ticket: string,
  projectId: string,
  now: number,
): Promise<string | null> {
  const row = await db
    .prepare(
      `DELETE FROM sync_tickets WHERE token_hash = ?1 AND project_id = ?2
       RETURNING user_id, expires_at`,
    )
    .bind(await hashToken(ticket), projectId)
    .first<{ user_id: string; expires_at: number }>()
  return row && row.expires_at > now ? row.user_id : null
}

/**
 * `/:id/sync` の認証。`?ticket=` があればそれを消費してユーザーを userId に入れ、使えなければ 401。
 * 無ければ requireUser と同じくヘッダで認証する。ブラウザの WebSocket はヘッダを付けられないのでチケットを使う
 */
export function requireSyncUser(now: () => number) {
  const byHeaders = requireUser(now)
  return createMiddleware<UserEnv>(async (c, next) => {
    const ticket = c.req.query(SYNC_TICKET_PARAM)
    if (ticket === undefined) return byHeaders(c, next)
    const userId = await consumeSyncTicket(c.env.DB, ticket, c.req.param('id') ?? '', now())
    if (userId === null) throw new ApiException('unauthorized')
    c.set('userId', userId)
    await next()
  })
}
