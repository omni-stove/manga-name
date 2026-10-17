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

if (import.meta.vitest) {
  const { createEmptyProject } = await import('@manga/schema')
  const { expect, test } = import.meta.vitest

  const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

  test('listProjects returns summaries, newest updatedAt first', async () => {
    const storage = createMemoryStorage()
    const old = { ...createEmptyProject('old'), updatedAt: '2026-01-01T00:00:00.000Z' }
    const recent = { ...createEmptyProject('recent'), updatedAt: '2026-02-01T00:00:00.000Z' }
    await storage.saveProject(old)
    await storage.saveProject(recent)
    expect(await storage.listProjects()).toEqual([
      { id: recent.id, title: 'recent', updatedAt: recent.updatedAt },
      { id: old.id, title: 'old', updatedAt: old.updatedAt },
    ])
  })

  test('saving again with the same id replaces the project', async () => {
    const storage = createMemoryStorage()
    const p = createEmptyProject('first')
    await storage.saveProject(p)
    await storage.saveProject({ ...p, title: 'second' })
    expect(await storage.listProjects()).toHaveLength(1)
    expect((await storage.loadProject(p.id)).title).toBe('second')
  })

  test('changes made after save or after load do not reach the stored project', async () => {
    const storage = createMemoryStorage()
    const p = createEmptyProject('kept')
    await storage.saveProject(p)
    p.title = 'changed after save'
    const loaded = await storage.loadProject(p.id)
    loaded.title = 'changed after load'
    expect((await storage.loadProject(p.id)).title).toBe('kept')
  })

  test('loadProject throws for an unknown id', async () => {
    await expect(createMemoryStorage().loadProject('missing')).rejects.toThrow('missing')
  })

  test('putAsset returns a blob: ref that loadAsset and resolveAsset resolve', async () => {
    const storage = createMemoryStorage()
    const blob = png()
    const ref = await storage.putAsset('pj', blob)
    expect(ref).toMatch(/^blob:.+/)
    expect(await storage.loadAsset(ref)).toBe(blob)
    const url = await storage.resolveAsset(ref)
    expect(url).toMatch(/^blob:/)
    URL.revokeObjectURL(url)
  })

  test('unknown and malformed asset refs throw', async () => {
    const storage = createMemoryStorage()
    await expect(storage.loadAsset('blob:missing')).rejects.toThrow('Asset not found')
    await expect(storage.resolveAsset('blob:missing')).rejects.toThrow('Asset not found')
    await expect(storage.loadAsset('file:art/a.png')).rejects.toThrow('Unsupported asset ref')
  })

  test('deleteProject removes the project and only its own assets', async () => {
    const storage = createMemoryStorage()
    const a = createEmptyProject('a')
    const b = createEmptyProject('b')
    await storage.saveProject(a)
    await storage.saveProject(b)
    const refA = await storage.putAsset(a.id, png())
    const refB = await storage.putAsset(b.id, png())
    await storage.deleteProject(a.id)
    expect((await storage.listProjects()).map((s) => s.id)).toEqual([b.id])
    await expect(storage.loadProject(a.id)).rejects.toThrow()
    await expect(storage.loadAsset(refA)).rejects.toThrow('Asset not found')
    expect((await storage.loadAsset(refB)).size).toBe(4)
    await expect(storage.deleteProject('missing')).resolves.toBeUndefined()
  })
}
