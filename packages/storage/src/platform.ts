import type { StorageKind } from './create'

export type Platform = 'desktop' | 'web'

/**
 * 動いている環境を返す。Tauri の WebView なら `desktop`、それ以外は `web`。
 * Tauri 2 が WebView に注入する `isTauri` を見る。
 */
export function detectPlatform(scope: object = globalThis): Platform {
  return 'isTauri' in scope && scope.isTauri === true ? 'desktop' : 'web'
}

/** 環境の既定の保存先。desktop はファイル、web は IndexedDB */
export function defaultStorageKind(platform: Platform = detectPlatform()): StorageKind {
  return platform === 'desktop' ? 'file' : 'indexeddb'
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('detectPlatform sees the isTauri flag that Tauri injects', () => {
    expect(detectPlatform({ isTauri: true })).toBe('desktop')
    expect(detectPlatform({})).toBe('web')
    expect(detectPlatform({ isTauri: 'yes' })).toBe('web')
    expect(detectPlatform()).toBe('web')
  })

  test('defaultStorageKind picks files on desktop and IndexedDB on the web', () => {
    expect(defaultStorageKind('desktop')).toBe('file')
    expect(defaultStorageKind('web')).toBe('indexeddb')
  })
}
