import { newId, type Project, parseProject } from '@manga/schema'
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import {
  byUpdatedAtDesc,
  parseAssetRef,
  type StorageAdapter,
  summarize,
  toAssetRef,
} from './adapter'

const DB_NAME = 'manga-name'
const DB_VERSION = 1

interface MangaDb extends DBSchema {
  projects: { key: string; value: Project }
  assets: {
    key: string
    value: { id: string; projectId: string; blob: Blob }
    indexes: { projectId: string }
  }
}

/**
 * IndexedDB に保存する StorageAdapter。アセットも Blob のまま保存する。
 * DB は最初の操作で開く。`name` を変えると別の DB になる。
 */
export function createIndexedDbStorage(name: string = DB_NAME): StorageAdapter {
  let opening: Promise<IDBPDatabase<MangaDb>> | undefined
  const db = () => {
    opening ??= openDB<MangaDb>(name, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('projects', { keyPath: 'id' })
        d.createObjectStore('assets', { keyPath: 'id' }).createIndex('projectId', 'projectId')
      },
    }).catch((e) => {
      // 失敗した Promise を残すと以降ずっと失敗するので、次の操作で開き直せるようにする
      opening = undefined
      throw e
    })
    return opening
  }

  const getAsset = async (ref: string) => {
    const asset = await (await db()).get('assets', parseAssetRef(ref))
    if (!asset) throw new Error(`Asset not found: ${ref}`)
    return asset
  }

  return {
    async listProjects() {
      return (await (await db()).getAll('projects')).map(summarize).sort(byUpdatedAtDesc)
    },
    async loadProject(id) {
      const p = await (await db()).get('projects', id)
      if (!p) throw new Error(`Project not found: ${id}`)
      return parseProject(p)
    },
    async saveProject(p) {
      await (await db()).put('projects', p)
    },
    async deleteProject(id) {
      const tx = (await db()).transaction(['projects', 'assets'], 'readwrite')
      const assets = tx.objectStore('assets')
      const keys = await assets.index('projectId').getAllKeys(id)
      await Promise.all([
        tx.objectStore('projects').delete(id),
        ...keys.map((k) => assets.delete(k)),
        tx.done,
      ])
    },
    async resolveAsset(ref) {
      return URL.createObjectURL((await getAsset(ref)).blob)
    },
    async loadAsset(ref) {
      return (await getAsset(ref)).blob
    },
    async putAsset(projectId, blob) {
      const id = newId()
      await (await db()).put('assets', { id, projectId, blob })
      return toAssetRef(id)
    },
  }
}
