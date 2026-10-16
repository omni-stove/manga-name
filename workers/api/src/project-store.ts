import type { Project } from '@manga/schema'

/** 1 チャンクの UTF-16 コード単位数。UTF-8 で最大 1.5MB になり、D1 の 1 行 2MB に収まる */
const CHUNK_UNITS = 500_000

/** 一覧用に projects.title へ写す最大文字数。本文の title は切らない */
const TITLE_COLUMN_CHARS = 200

interface ProjectSummary {
  id: string
  title: string
  updatedAt: string
}

type SaveResult =
  | { status: 'saved'; updatedAt: string }
  | { status: 'conflict'; updatedAt: string }
  | { status: 'not-found' }

/** 文字列を CHUNK_UNITS 以下に分ける。サロゲートペアの間では切らない */
export function splitDoc(text: string): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + CHUNK_UNITS, text.length)
    // 片割れのサロゲートは TEXT として保存すると壊れる
    const last = text.charCodeAt(end - 1)
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}

/**
 * 直前の updated_at（If-Match の値）より必ず後になる、次の updated_at を返す。
 * 同じミリ秒の保存でも ETag が変わらないと、古い版を持つクライアントの上書きを通してしまう。
 */
function nextUpdatedAt(previous: string, now: number): string {
  const prev = Date.parse(previous)
  return new Date(Number.isNaN(prev) ? now : Math.max(now, prev + 1)).toISOString()
}

const titleColumn = (title: string) => [...title].slice(0, TITLE_COLUMN_CHARS).join('')

function insertChunks(db: D1Database, projectId: string, rev: string, doc: string) {
  // rev が projects に載ったときだけ入れる。UPDATE が競合で外れた保存の本文を残さないため
  return splitDoc(doc).map((data, seq) =>
    db
      .prepare(
        `INSERT INTO project_doc_chunks (project_id, rev, seq, data)
         SELECT ?1, ?2, ?3, ?4
         WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?1 AND rev = ?2)`,
      )
      .bind(projectId, rev, seq, data),
  )
}

/** owner のプロジェクトを新しい順に返す */
export async function listProjects(db: D1Database, ownerId: string): Promise<ProjectSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT id, title, updated_at AS updatedAt FROM projects
       WHERE owner_id = ?1 ORDER BY updated_at DESC`,
    )
    .bind(ownerId)
    .all<ProjectSummary>()
  return results
}

/** owner のプロジェクトの保存済み JSON 文字列と updated_at。無ければ null */
export async function readProject(
  db: D1Database,
  ownerId: string,
  id: string,
): Promise<{ doc: string; updatedAt: string } | null> {
  // 1 文で読むのは、読んでいる途中に別の保存が rev を差し替えても版が混ざらないようにするため
  const { results } = await db
    .prepare(
      `SELECT p.updated_at AS updatedAt, c.data AS data FROM projects p
       JOIN project_doc_chunks c ON c.project_id = p.id AND c.rev = p.rev
       WHERE p.id = ?1 AND p.owner_id = ?2
       ORDER BY c.seq`,
    )
    .bind(id, ownerId)
    .all<{ updatedAt: string; data: string }>()
  const first = results[0]
  if (!first) return null
  return { doc: results.map((r) => r.data).join(''), updatedAt: first.updatedAt }
}

/** users に owner が無ければ作り、project を owner のものとして保存する。project.updatedAt を updated_at にする */
export async function insertProject(
  db: D1Database,
  ownerId: string,
  project: Project,
  now: number,
): Promise<void> {
  const rev = crypto.randomUUID()
  await db.batch([
    db
      .prepare('INSERT INTO users (id, created_at) VALUES (?1, ?2) ON CONFLICT (id) DO NOTHING')
      .bind(ownerId, now),
    db
      .prepare(
        `INSERT INTO projects (id, owner_id, title, updated_at, rev)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(project.id, ownerId, titleColumn(project.title), project.updatedAt, rev),
    ...insertChunks(db, project.id, rev, JSON.stringify(project)),
  ])
}

/**
 * updated_at が expected のときだけ project で置き換える（楽観ロック）。
 * 保存する本文の updatedAt はサーバが決めた新しい updated_at に書き換える。
 * 一致しなければ現在の updated_at を conflict で返し、owner のものが無ければ not-found。
 */
export async function saveProject(
  db: D1Database,
  ownerId: string,
  project: Project,
  expected: string,
  now: number,
): Promise<SaveResult> {
  const rev = crypto.randomUUID()
  const updatedAt = nextUpdatedAt(expected, now)
  const doc = JSON.stringify({ ...project, updatedAt })
  // batch は 1 トランザクションで直列に走るので、UPDATE の条件判定と本文の差し替えの間に他の保存は入らない
  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE projects SET title = ?4, updated_at = ?5, rev = ?6
         WHERE id = ?1 AND owner_id = ?2 AND updated_at = ?3`,
      )
      .bind(project.id, ownerId, expected, titleColumn(project.title), updatedAt, rev),
    ...insertChunks(db, project.id, rev, doc),
    db
      .prepare(
        `DELETE FROM project_doc_chunks
         WHERE project_id = ?1 AND rev <> (SELECT rev FROM projects WHERE id = ?1)`,
      )
      .bind(project.id),
  ])
  if (update?.meta.changes === 1) return { status: 'saved', updatedAt }

  const current = await db
    .prepare('SELECT updated_at AS updatedAt FROM projects WHERE id = ?1 AND owner_id = ?2')
    .bind(project.id, ownerId)
    .first<{ updatedAt: string }>()
  return current ? { status: 'conflict', updatedAt: current.updatedAt } : { status: 'not-found' }
}

/** owner のプロジェクトを本文とアセットの行ごと消す。消したら true。R2 の本体は呼び出し側が消す */
export async function deleteProject(db: D1Database, ownerId: string, id: string) {
  // 外部キーの CASCADE が無効な環境でも本文を残さないよう、本文から明示的に消す
  const [, , removed] = await db.batch([
    db
      .prepare(
        `DELETE FROM project_doc_chunks
         WHERE project_id = (SELECT id FROM projects WHERE id = ?1 AND owner_id = ?2)`,
      )
      .bind(id, ownerId),
    db
      .prepare(
        `DELETE FROM assets
         WHERE project_id = (SELECT id FROM projects WHERE id = ?1 AND owner_id = ?2)`,
      )
      .bind(id, ownerId),
    db.prepare('DELETE FROM projects WHERE id = ?1 AND owner_id = ?2').bind(id, ownerId),
  ])
  return removed?.meta.changes === 1
}
