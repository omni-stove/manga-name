import type { ID, ISODate, Project } from '@manga/schema'

export interface ProjectSummary {
  id: ID
  title: string
  updatedAt: ISODate
}

/** プロジェクトとアセットの保存先。Web と Desktop の差はこの実装の選択に閉じる */
export interface StorageAdapter {
  /** 保存済みプロジェクトの概要。updatedAt の新しい順 */
  listProjects(): Promise<ProjectSummary[]>
  /**
   * 保存されているかどうか。読めない内容でも保存されていれば true。
   * 実装しないアダプタでは listProjects に出るかどうかで判定する
   */
  hasProject?(id: ID): Promise<boolean>
  /** この id で保存できるか。実装しないアダプタはどの id でも保存できる */
  canStoreId?(id: ID): boolean
  /** 無ければ throw する。保存内容は parseProject を通して返す */
  loadProject(id: ID): Promise<Project>
  saveProject(p: Project): Promise<void>
  /** プロジェクトとそのアセットを消す。無いプロジェクトは何もしない */
  deleteProject(id: ID): Promise<void>
  /** ref を解決して表示用 URL を返す。呼び出し側が URL.revokeObjectURL で解放する。無ければ throw する */
  resolveAsset(ref: string): Promise<string>
  /** ref を解決して Blob を返す。無ければ throw する */
  loadAsset(ref: string): Promise<Blob>
  /** 画像を保存し `blob:<id>` の ref を返す */
  putAsset(projectId: ID, blob: Blob, hint?: string): Promise<string>
}

const BLOB_PREFIX = 'blob:'

export function toAssetRef(id: string): string {
  return `${BLOB_PREFIX}${id}`
}

/** `blob:<id>` から id を取り出す。他の形式は未対応として throw する */
export function parseAssetRef(ref: string): string {
  if (!ref.startsWith(BLOB_PREFIX) || ref.length === BLOB_PREFIX.length) {
    throw new Error(`Unsupported asset ref: ${ref}`)
  }
  return ref.slice(BLOB_PREFIX.length)
}

export function summarize(p: Project): ProjectSummary {
  return { id: p.id, title: p.title, updatedAt: p.updatedAt }
}

export function byUpdatedAtDesc(a: ProjectSummary, b: ProjectSummary): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
}
