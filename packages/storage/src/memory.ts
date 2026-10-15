import { newId, type Project, parseProject } from '@manga/schema'
import {
  byUpdatedAtDesc,
  parseAssetRef,
  type StorageAdapter,
  summarize,
  toAssetRef,
} from './adapter'

/**
 * メモリだけに保存する StorageAdapter。リロードで消える。テストと他パッケージのモック用。
 */
export function createMemoryStorage(): StorageAdapter {
  const projects = new Map<string, Project>()
  const assets = new Map<string, { projectId: string; blob: Blob }>()

  const getAsset = (ref: string) => {
    const asset = assets.get(parseAssetRef(ref))
    if (!asset) throw new Error(`Asset not found: ${ref}`)
    return asset
  }

  return {
    async listProjects() {
      return [...projects.values()].map(summarize).sort(byUpdatedAtDesc)
    },
    async loadProject(id) {
      const p = projects.get(id)
      if (!p) throw new Error(`Project not found: ${id}`)
      return parseProject(structuredClone(p))
    },
    async saveProject(p) {
      // 呼び出し側の以降の変更が保存内容に混ざらないよう、保存時点で複製する
      projects.set(p.id, structuredClone(p))
    },
    async deleteProject(id) {
      projects.delete(id)
      for (const [assetId, asset] of assets) {
        if (asset.projectId === id) assets.delete(assetId)
      }
    },
    async resolveAsset(ref) {
      return URL.createObjectURL(getAsset(ref).blob)
    },
    async loadAsset(ref) {
      return getAsset(ref).blob
    },
    async putAsset(projectId, blob) {
      const id = newId()
      assets.set(id, { projectId, blob })
      return toAssetRef(id)
    },
  }
}
