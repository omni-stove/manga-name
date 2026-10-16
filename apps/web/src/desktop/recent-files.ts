import type { ID } from '@manga/schema'
import { desktopStore } from './desktop-store'

/** 開くか保存したファイルと、読み込んだ先のプロジェクト */
export interface RecentFile {
  path: string
  projectId: ID
}

const KEY = 'recentFiles'
const MAX_RECENT = 10

/** `file` を先頭に足す。同じパスの古い項目は消し、MAX_RECENT 件までにする */
export function pushRecent(list: readonly RecentFile[], file: RecentFile): RecentFile[] {
  return [file, ...list.filter((f) => f.path !== file.path)].slice(0, MAX_RECENT)
}

/** メニューに出す名前。パスの最後の要素 */
export function recentLabel(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export async function loadRecentFiles(): Promise<RecentFile[]> {
  return (await (await desktopStore()).get<RecentFile[]>(KEY)) ?? []
}

export async function saveRecentFiles(list: readonly RecentFile[]): Promise<void> {
  const store = await desktopStore()
  await store.set(KEY, list)
  await store.save()
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('pushRecent moves a reopened path to the top and caps the list', () => {
    const files = Array.from({ length: MAX_RECENT }, (_, i) => ({
      path: `/f${i}`,
      projectId: `p${i}`,
    }))
    expect(pushRecent(files, { path: '/f3', projectId: 'x' }).map((f) => f.path)).toEqual([
      '/f3',
      ...files.filter((f) => f.path !== '/f3').map((f) => f.path),
    ])
    const added = pushRecent(files, { path: '/new', projectId: 'n' })
    expect(added).toHaveLength(MAX_RECENT)
    expect(added[0]?.path).toBe('/new')
    expect(added.at(-1)?.path).toBe('/f8')
  })

  test('recentLabel takes the file name on both separators', () => {
    expect(recentLabel('/Users/a/作品.manga.json')).toBe('作品.manga.json')
    expect(recentLabel('C:\\work\\b.manga.json')).toBe('b.manga.json')
  })
}
