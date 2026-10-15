interface AssetRow {
  key: string
  mime: string
  size: number
}

/** R2 のキー */
export const assetKey = (projectId: string, assetId: string) => `${projectId}/${assetId}`

/** owner のプロジェクトがあれば true */
export async function ownsProject(db: D1Database, ownerId: string, projectId: string) {
  const row = await db
    .prepare('SELECT 1 AS found FROM projects WHERE id = ?1 AND owner_id = ?2')
    .bind(projectId, ownerId)
    .first<{ found: number }>()
  return row !== null
}

/** owner のプロジェクトにあるアセットの key、mime、size。無ければ null */
export function readAsset(
  db: D1Database,
  ownerId: string,
  projectId: string,
  assetId: string,
): Promise<AssetRow | null> {
  return db
    .prepare(
      `SELECT a.key AS key, a.mime AS mime, a.size AS size FROM assets a
       JOIN projects p ON p.id = a.project_id
       WHERE a.id = ?1 AND a.project_id = ?2 AND p.owner_id = ?3`,
    )
    .bind(assetId, projectId, ownerId)
    .first<AssetRow>()
}

/**
 * プロジェクトが残っていて同じ id の行が無ければ assets に 1 行入れる。
 * 入れたら inserted、id が使用済みなら exists、プロジェクトが無ければ no-project。
 */
export async function insertAsset(
  db: D1Database,
  asset: { id: string; projectId: string; mime: string; size: number; createdAt: number },
): Promise<'inserted' | 'exists' | 'no-project'> {
  const { meta } = await db
    .prepare(
      `INSERT INTO assets (id, project_id, key, mime, size, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE EXISTS (SELECT 1 FROM projects WHERE id = ?2)
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(
      asset.id,
      asset.projectId,
      assetKey(asset.projectId, asset.id),
      asset.mime,
      asset.size,
      asset.createdAt,
    )
    .run()
  if (meta.changes === 1) return 'inserted'
  return (await projectExists(db, asset.projectId)) ? 'exists' : 'no-project'
}

/** プロジェクトが残っていれば true。所有者は問わない */
export async function projectExists(db: D1Database, projectId: string) {
  const row = await db
    .prepare('SELECT 1 AS found FROM projects WHERE id = ?1')
    .bind(projectId)
    .first<{ found: number }>()
  return row !== null
}

/** assets の行を owner の確認なしに消す。アップロードに失敗した行の取り消しに使う */
export async function discardAsset(db: D1Database, assetId: string) {
  await db.prepare('DELETE FROM assets WHERE id = ?1').bind(assetId).run()
}

/** owner のプロジェクトにあるアセットの行を消し、その key を返す。無ければ null */
export async function deleteAsset(
  db: D1Database,
  ownerId: string,
  projectId: string,
  assetId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `DELETE FROM assets
       WHERE id = ?1 AND project_id = ?2
         AND EXISTS (SELECT 1 FROM projects WHERE id = ?2 AND owner_id = ?3)
       RETURNING key`,
    )
    .bind(assetId, projectId, ownerId)
    .first<{ key: string }>()
  return row?.key ?? null
}

/** R2 からプロジェクトのアセット本体をすべて消す */
export async function deleteAssetObjects(bucket: R2Bucket, projectId: string) {
  let cursor: string | undefined
  do {
    const listed = await bucket.list({ prefix: `${projectId}/`, cursor })
    if (listed.objects.length > 0) await bucket.delete(listed.objects.map((o) => o.key))
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor !== undefined)
}
