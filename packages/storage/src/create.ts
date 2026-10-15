import type { StorageAdapter } from './adapter'
import { createIndexedDbStorage } from './indexeddb'
import { createMemoryStorage } from './memory'

export type StorageKind = 'memory' | 'indexeddb'

/** アプリ設定の種別から StorageAdapter を作る。 */
export function createStorage(kind: StorageKind): StorageAdapter {
  switch (kind) {
    case 'memory':
      return createMemoryStorage()
    case 'indexeddb':
      return createIndexedDbStorage()
  }
}
