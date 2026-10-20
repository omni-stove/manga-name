import {
  createMemoryHistory,
  createRouter,
  type RouterHistory,
  RouterProvider,
} from '@tanstack/react-router'
import type { ProjectLibrary } from './project-library'
import { RouteError } from './route-error'
import type { RouterContext } from './router-context'
import { routeTree } from './routeTree.gen'

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
  const { m } = await import('@manga/i18n')
  const { fixtures } = await import('@manga/schema')
  const { createIndexedDbStorage, createMemoryStorage, createMemoryYDocStore } = await import(
    '@manga/storage'
  )
  const { createPanelGeneration } = await import('./generate-panel')
  const { createImageProvider } = await import('./image-provider')
  const { createLlmProvider } = await import('./llm-provider')
  const { createProjectLibrary } = await import('./project-library')
  const { createSharingClient } = await import('./sharing')
  const { addPagePatch } = await import('./project-ops')
  const { createFakeSyncServer } = await import('@manga/collab')
  // fake-indexeddb の exports は ./auto に types を付けていないので、副作用 import の型解決は諦める
  // @ts-expect-error TS7016
  await import('fake-indexeddb/auto')

  const render = async (library: ProjectLibrary, path: string) => {
    const imageProvider = createImageProvider({ baseUrl: '', getToken: async () => null })
    const router = createAppRouter(
      {
        library,
        imageProvider,
        llmProvider: createLlmProvider({ baseUrl: '', getToken: async () => null }),
        generation: createPanelGeneration({ library, imageProvider }),
        sharing: createSharingClient({ baseUrl: '', fetch, cloudId: async () => null }),
        auth: { getUser: () => null },
      },
      createMemoryHistory({ initialEntries: [path] }),
    )
    await router.load()
    return renderToString(<RouterProvider router={router} />)
  }

  const project = fixtures.samplePage01
  const projectId = project.id
  const episodeId = project.episodes[0]?.id ?? ''
  const pageId = project.episodes[0]?.pages[0]?.id ?? ''

  let library: ProjectLibrary
  beforeEach(async () => {
    const storage = createMemoryStorage()
    await storage.saveProject(project)
    library = createProjectLibrary(storage)
  })

  describe('7 ルートが描画される', () => {
    test.each([
      ['/', m.web_project_list()],
      ['/new', m.web_new_project_title()],
      [`/p/${projectId}`, m.web_episodes_add()],
      [`/p/${projectId}/episodes/${episodeId}`, m.web_draft_title()],
      [`/p/${projectId}/pages/${pageId}`, m.web_editor_inspector()],
      [`/p/${projectId}/characters`, m.web_characters_title()],
      [`/p/${projectId}/characters/new`, m.web_character_reference_hint()],
    ])('%s', async (path, heading) => {
      expect(await render(library, path)).toContain(heading)
    })
  })

  test('「はじめに」を開くと案内を最初の手順から始める', async () => {
    const { tour } = await import('./onboarding/tour')
    try {
      await render(library, '/onboarding')
      expect(tour.state.getState()).toEqual({ step: 'project' })
    } finally {
      tour.finish()
    }
  })

  test('設定は ?settings= のときだけ、今の画面の上にダイアログで出る', async () => {
    const editor = `/p/${projectId}/pages/${pageId}`
    expect(await render(library, editor)).not.toContain(m.project_settings_page_size())
    const project = await render(library, `${editor}?settings=project`)
    expect(project).toContain(m.project_settings_page_size())
    expect(project).toContain(m.web_editor_inspector())
    expect(await render(library, `/p/${projectId}?settings=app`)).toContain(m.web_settings_theme())
    // プロジェクトを開いていない画面にはプロジェクト設定を出さない
    expect(await render(library, '/?settings=project')).not.toContain(
      m.project_settings_page_size(),
    )
  })

  test('保存済みのプロジェクトが一覧に出る', async () => {
    expect(await render(library, '/')).toContain(project.title)
  })

  test('エピソード一覧にエピソードとページ数が出て、ページの追加はエピソードを開いた先にある', async () => {
    const html = await render(library, `/p/${projectId}`)
    expect(html).toContain(`/p/${projectId}/episodes/${episodeId}`)
    expect(html).toContain(project.episodes[0]?.title)
    expect(html).toContain(m.web_episodes_page_count({ count: 1 }))
    expect(html).not.toContain(m.web_episode_add_page())
    expect(html).not.toContain(m.web_draft_title())
  })

  test('エピソードにページと生成状況が出る', async () => {
    const html = await render(library, `/p/${projectId}/episodes/${episodeId}`)
    expect(html).toContain(`/p/${projectId}/pages/${pageId}`)
    expect(html).toContain(m.web_art_status_none())
    expect(html).toContain(m.web_episode_add_page())
  })

  test('知らないプロジェクトとエピソードとページは見つからない旨を出す', async () => {
    expect(await render(library, '/p/nope')).toContain(m.web_not_found_project())
    expect(await render(library, `/p/${projectId}/episodes/nope`)).toContain(
      m.web_episode_not_found(),
    )
    expect(await render(library, `/p/${projectId}/pages/nope`)).toContain(m.web_not_found_page())
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
    const episode = (await after.open(created.id))?.get().episodes[0]
    const html = await render(after, `/p/${created.id}/episodes/${episode?.id}`)
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
