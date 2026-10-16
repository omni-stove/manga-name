import {
  createMemoryHistory,
  createRouter,
  type RouterHistory,
  RouterProvider,
} from '@tanstack/react-router'
import type { ProjectLibrary } from './project-library'
import { RouteError } from './route-error'
import { routeTree } from './routeTree.gen'

/** 各ルートの loader と画面が `context` から使う依存 */
export interface RouterContext {
  library: ProjectLibrary
}

/** アプリのルーター。`history` を省くとブラウザ履歴を使う */
export function createAppRouter(context: RouterContext, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context,
    history,
    defaultPreload: 'intent',
    defaultErrorComponent: RouteError,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}

if (import.meta.vitest) {
  const { beforeEach, describe, expect, test, vi } = import.meta.vitest
  const { renderToString } = await import('react-dom/server')
  const { fixtures } = await import('@manga/schema')
  const { createIndexedDbStorage, createMemoryStorage, createMemoryYDocStore } = await import(
    '@manga/storage'
  )
  const { createProjectLibrary } = await import('./project-library')
  const { addPagePatch } = await import('./project-ops')
  const { createFakeSyncServer } = await import('./store/fake-sync-server')
  // fake-indexeddb の exports は ./auto に types を付けていないので、副作用 import の型解決は諦める
  // @ts-expect-error TS7016
  await import('fake-indexeddb/auto')

  const render = async (library: ProjectLibrary, path: string) => {
    const router = createAppRouter({ library }, createMemoryHistory({ initialEntries: [path] }))
    await router.load()
    return renderToString(<RouterProvider router={router} />)
  }

  const project = fixtures.samplePage01
  const projectId = project.id
  const pageId = project.episodes[0]?.pages[0]?.id ?? ''

  let library: ProjectLibrary
  beforeEach(async () => {
    const storage = createMemoryStorage()
    await storage.saveProject(project)
    library = createProjectLibrary(storage)
  })

  describe('6 ルートが描画される', () => {
    test.each([
      ['/', 'プロジェクト一覧'],
      [`/p/${projectId}`, 'ページ一覧'],
      [`/p/${projectId}/pages/${pageId}`, 'インスペクタ'],
      [`/p/${projectId}/characters`, 'キャラクター一覧'],
      [`/p/${projectId}/settings`, 'プロジェクト設定'],
      ['/settings', 'アプリ設定'],
    ])('%s', async (path, heading) => {
      expect(await render(library, path)).toContain(heading)
    })
  })

  test('保存済みのプロジェクトが一覧に出る', async () => {
    expect(await render(library, '/')).toContain(project.title)
  })

  test('ページ一覧にページと生成状況が出る', async () => {
    const html = await render(library, `/p/${projectId}`)
    expect(html).toContain(`/p/${projectId}/pages/${pageId}`)
    expect(html).toContain('未生成')
  })

  test('知らないプロジェクトとページは見つからない旨を出す', async () => {
    expect(await render(library, '/p/nope')).toContain('見つかりません')
    expect(await render(library, `/p/${projectId}/pages/nope`)).toContain('見つかりません')
  })

  test('リロード後も IndexedDB から復元される', async () => {
    const name = `test-${crypto.randomUUID()}`
    const before = createProjectLibrary(createIndexedDbStorage(name))
    const created = await before.create('復元テスト')
    const store = await before.open(created.id)
    if (!store) throw new Error('作ったプロジェクトが開けない')
    const { patch, page } = addPagePatch(store.get(), '3rows')
    store.applyPatch(patch)
    await before.flushAll()

    // 別のアダプタとライブラリで開き直すことで、メモリ上の状態を持ち越さないリロードを再現する
    const after = createProjectLibrary(createIndexedDbStorage(name))
    expect(await render(after, '/')).toContain('復元テスト')
    const html = await render(after, `/p/${created.id}`)
    expect(html).toContain(`/p/${created.id}/pages/${page.id}`)
    expect((await after.open(created.id))?.get().episodes[0]?.pages[0]?.panels).toHaveLength(6)
  })

  test('他のクライアントの選択がエディタにカーソル色で出る', async () => {
    const server = createFakeSyncServer()
    const device = async (userName: string) => {
      const storage = createMemoryStorage()
      await storage.saveProject(project)
      const opened = createProjectLibrary(storage, {
        collaboration: {
          syncUrl: async () => 'wss://sync.test/v1/projects/p/sync',
          ydocs: createMemoryYDocStore(),
          userName,
          createSocket: (url) => server.createSocket(url),
          firstSyncTimeoutMs: 1000,
          minReconnectMs: 5,
        },
      })
      await opened.open(projectId)
      return opened
    }
    const alice = await device('alice')
    const bob = await device('bob')
    const panelId = project.episodes[0]?.pages[0]?.panels[0]?.id ?? ''
    const aliceColor = alice.collaboration(projectId)?.presence.color
    alice.collaboration(projectId)?.presence.setLocation({ pageId, selection: [panelId] })
    await vi.waitFor(() =>
      expect(bob.collaboration(projectId)?.presence.peers.getState()).toEqual([
        expect.objectContaining({ name: 'alice', selection: [panelId] }),
      ]),
    )

    const html = await render(bob, `/p/${projectId}/pages/${pageId}`)
    expect(html).toContain(`--peer-color:${aliceColor}`)
    expect(html).toContain('data-peer-selected="true"')
    expect(html).toContain('alice')
    await alice.remove(projectId)
    await bob.remove(projectId)
  })
}
