import { fixtures } from '@manga/schema'
import {
  createMemoryHistory,
  createRouter,
  type RouterHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/** アプリのルーター。`history` を省くとブラウザ履歴を使う */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultPreload: 'intent' })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { renderToString } = await import('react-dom/server')

  const render = async (path: string) => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
    await router.load()
    return renderToString(<RouterProvider router={router} />)
  }

  const project = fixtures.samplePage01
  const projectId = project.id
  const pageId = project.episodes[0]?.pages[0]?.id ?? ''

  describe('6 ルートが描画される', () => {
    test.each([
      ['/', 'プロジェクト一覧'],
      [`/p/${projectId}`, 'ページ一覧'],
      [`/p/${projectId}/pages/${pageId}`, 'インスペクタ'],
      [`/p/${projectId}/characters`, 'キャラクター一覧'],
      [`/p/${projectId}/settings`, 'プロジェクト設定'],
      ['/settings', 'アプリ設定'],
    ])('%s', async (path, heading) => {
      expect(await render(path)).toContain(heading)
    })
  })

  test('フィクスチャのページが一覧に出る', async () => {
    expect(await render(`/p/${projectId}`)).toContain(pageId)
  })

  test('知らないプロジェクトは見つからない旨を出す', async () => {
    expect(await render('/p/nope')).toContain('見つかりません')
  })
}
