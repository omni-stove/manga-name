import {
  createMemoryHistory,
  createRouter,
  type RouterHistory,
  RouterProvider,
} from '@tanstack/react-router'
import type { AuthClient } from './auth'
import type { PanelGeneration } from './generate-panel'
import type { ImageProvider } from './image-provider'
import type { LlmProvider } from './llm-provider'
import type { ProjectLibrary } from './project-library'
import { RouteError } from './route-error'
import { routeTree } from './routeTree.gen'
import type { SharingClient } from './sharing'

/** 各ルートの loader と画面が `context` から使う依存 */
export interface RouterContext {
  library: ProjectLibrary
  /** 生成に使う ImageProvider。`createImageProvider()` で API の URL とログインから作る */
  imageProvider: ImageProvider
  /** 「脚本から下書き」と「AI に相談」に使う LlmProvider。`createLlmProvider()` で API の URL とログインから作る */
  llmProvider: LlmProvider
  /** コマの生成と進行状況。画面を離れても生成が続くよう、ルーターより長く生きる */
  generation: PanelGeneration
  /** プロジェクトの参加者と招待 */
  sharing: SharingClient
  /** ログイン状態。ログインが要る読み込みを loader で分けるのに使う */
  auth: Pick<AuthClient, 'getUser'>
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
  const { createPanelGeneration } = await import('./generate-panel')
  const { createImageProvider } = await import('./image-provider')
  const { createLlmProvider } = await import('./llm-provider')
  const { createProjectLibrary } = await import('./project-library')
  const { createSharingClient } = await import('./sharing')
  const { addPagePatch } = await import('./project-ops')
  const { createFakeSyncServer } = await import('./store/fake-sync-server')
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
      ['/', 'プロジェクト一覧'],
      ['/new', '新規プロジェクト'],
      [`/p/${projectId}`, 'エピソードを追加'],
      [`/p/${projectId}/episodes/${episodeId}`, '脚本から下書き'],
      [`/p/${projectId}/pages/${pageId}`, 'インスペクタ'],
      [`/p/${projectId}/characters`, 'キャラクター一覧'],
      [`/p/${projectId}/characters/new`, '外見から生成'],
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
    expect(await render(library, editor)).not.toContain('判型')
    const project = await render(library, `${editor}?settings=project`)
    expect(project).toContain('判型')
    expect(project).toContain('インスペクタ')
    expect(await render(library, `/p/${projectId}?settings=app`)).toContain('テーマ')
    // プロジェクトを開いていない画面にはプロジェクト設定を出さない
    expect(await render(library, '/?settings=project')).not.toContain('判型')
  })

  test('保存済みのプロジェクトが一覧に出る', async () => {
    expect(await render(library, '/')).toContain(project.title)
  })

  test('エピソード一覧にエピソードとページ数が出て、ページの追加はエピソードを開いた先にある', async () => {
    const html = await render(library, `/p/${projectId}`)
    expect(html).toContain(`/p/${projectId}/episodes/${episodeId}`)
    expect(html).toContain(project.episodes[0]?.title)
    expect(html).toContain('1 ページ')
    expect(html).not.toContain('ページを追加')
    expect(html).not.toContain('脚本から下書き')
  })

  test('エピソードにページと生成状況が出る', async () => {
    const html = await render(library, `/p/${projectId}/episodes/${episodeId}`)
    expect(html).toContain(`/p/${projectId}/pages/${pageId}`)
    expect(html).toContain('未生成')
    expect(html).toContain('ページを追加')
  })

  test('知らないプロジェクトとエピソードとページは見つからない旨を出す', async () => {
    expect(await render(library, '/p/nope')).toContain('見つかりません')
    expect(await render(library, `/p/${projectId}/episodes/nope`)).toContain('見つかりません')
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
