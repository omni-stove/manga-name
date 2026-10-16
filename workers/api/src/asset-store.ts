interface AssetRow {
  key: string
  mime: string
  size: number
}

/** R2 のキー */
export const assetKey = (projectId: string, assetId: string) => `${projectId}/${assetId}`

/** プロジェクトにある、削除されていないアセットの key、mime、size。無ければ null。ロールは呼び出し側が確かめる */
export function readAsset(
  db: D1Database,
  projectId: string,
  assetId: string,
): Promise<AssetRow | null> {
  return db
    .prepare(
      `SELECT key, mime, size FROM assets
       WHERE id = ?1 AND project_id = ?2 AND deleted_at IS NULL`,
    )
    .bind(assetId, projectId)
    .first<AssetRow>()
}

/**
 * プロジェクトが残っていて同じ id の行が無ければ assets に 1 行入れる。
 * 入れたら inserted、id が使用済み（削除済みを含む）なら exists、プロジェクトが無ければ no-project。
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
async function projectExists(db: D1Database, projectId: string) {
  const row = await db
    .prepare('SELECT 1 AS found FROM projects WHERE id = ?1')
    .bind(projectId)
    .first<{ found: number }>()
  return row !== null
}

/** 削除されていないアセットの行が残っていれば true。所有者は問わない */
export async function assetIsLive(db: D1Database, assetId: string) {
  const row = await db
    .prepare('SELECT 1 AS found FROM assets WHERE id = ?1 AND deleted_at IS NULL')
    .bind(assetId)
    .first<{ found: number }>()
  return row !== null
}

/**
 * assets の行を owner の確認なしに消す。アップロードに失敗した行の取り消しに使う。
 * 削除済みの行は残す。消すと、削除した id の署名 URL で PUT し直せてしまう
 */
export async function discardAsset(db: D1Database, assetId: string) {
  await db.prepare('DELETE FROM assets WHERE id = ?1 AND deleted_at IS NULL').bind(assetId).run()
}

/**
 * プロジェクトにあるアセットに deleted_at を立て、その key を返す。
 * 無いか削除済みなら null。ロールは呼び出し側が確かめる。
 */
export async function deleteAsset(
  db: D1Database,
  projectId: string,
  assetId: string,
  now: number,
): Promise<string | null> {
  const row = await db
    .prepare(
      `UPDATE assets SET deleted_at = ?3
       WHERE id = ?1 AND project_id = ?2 AND deleted_at IS NULL
       RETURNING key`,
    )
    .bind(assetId, projectId, now)
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
