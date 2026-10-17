import { type Project, parseProject } from '@manga/schema'
import * as Y from 'yjs'
import type { Env } from './env'

/** owner は projects.owner_id、それ以外は project_members.role */
export type ProjectRole = 'owner' | 'editor' | 'commenter' | 'viewer'

/** 招待と参加者に付けられるロール。owner は譲らない */
export const MEMBER_ROLES = ['editor', 'commenter', 'viewer'] as const

/** プロジェクトの本文を何でも書けるロール */
export const canEdit = (role: ProjectRole) => role === 'owner' || role === 'editor'

/** プロジェクトでの user のロール。プロジェクトが無いか参加していなければ null */
export async function projectRole(
  db: D1Database,
  userId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  const row = await db
    .prepare(
      `SELECT CASE WHEN p.owner_id = ?2 THEN 'owner' ELSE m.role END AS role
       FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?2
       WHERE p.id = ?1`,
    )
    .bind(projectId, userId)
    .first<{ role: ProjectRole | null }>()
  return row?.role ?? null
}

/**
 * user のメールアドレス。Better Auth のユーザーに無ければ null。
 * development では X-Debug-User がメールアドレスの形ならそれを使う。開発時のユーザーは auth_users に居ないため
 */
export async function userEmail(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT email FROM auth_users WHERE id = ?1')
    .bind(userId)
    .first<{ email: string }>()
  if (row) return row.email
  return env.ENVIRONMENT === 'development' && userId.includes('@') ? userId : null
}

/** 比較用に、全ページの scribbles と updatedAt を除いた JSON */
function withoutScribbles(project: Project) {
  return JSON.stringify({
    ...project,
    updatedAt: undefined,
    episodes: project.episodes.map((e) => ({
      ...e,
      pages: e.pages.map((p) => ({ ...p, scribbles: undefined })),
    })),
  })
}

/** saved（保存済みの JSON 文字列）から next への変更が、ページの scribbles だけなら true */
export function changesOnlyScribbles(saved: string, next: Project): boolean {
  let before: Project
  try {
    before = parseProject(JSON.parse(saved))
  } catch {
    return false
  }
  return withoutScribbles(before) === withoutScribbles(next)
}

/** type が、キー scribbles に置かれた型（Page.scribbles）かその子孫なら true */
function insideScribbles(type: Pick<Y.AbstractType<unknown>, '_item'>): boolean {
  for (
    let item = type._item;
    item !== null;
    item = (item.parent as Y.AbstractType<unknown>)._item
  ) {
    if (item.parentSub === 'scribbles') return true
  }
  return false
}

/**
 * update を doc に当てたときに変わるのが、role が書いてよい範囲だけなら true。doc は変えない。
 * owner と editor は何でも、commenter はページの scribbles の中だけ、viewer は何も変えられない。
 * 依存が欠けて当て切れない update も false にする。保留された部分が後から届く更新で効いてしまうため
 */
export function updateAllowed(doc: Y.Doc, update: Uint8Array, role: ProjectRole): boolean {
  if (canEdit(role)) return true
  // Yjs の変更は取り消せないので、写しに当てて変わった型を見る
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  let allowed = true
  copy.on('afterTransaction', (transaction: Y.Transaction) => {
    for (const [type, keys] of transaction.changed) {
      if (role !== 'commenter') allowed = false
      else if (insideScribbles(type)) continue
      // クライアントは scribbles の変更と同じトランザクションでルートの updatedAt も書く
      else if (type._item === null && keys.size === 1 && keys.has('updatedAt')) continue
      else allowed = false
    }
  })
  Y.applyUpdate(copy, update)
  return allowed && copy.store.pendingStructs === null && copy.store.pendingDs === null
}
