import {
  createCloudStorage,
  createIndexedDbYDocStore,
  createStorage,
  defaultStorageKind,
  detectPlatform,
} from '@manga/storage'
import { applyThemePreference, readThemePreference } from '@manga/ui'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createAuthClient } from './auth'
import { createDesktopTokenStore } from './desktop/desktop-store'
import { createPanelGeneration } from './generate-panel'
import { createImageProvider, readApiBaseUrl } from './image-provider'
import { createProjectLibrary } from './project-library'
import { createAppRouter } from './router'
import { createSharingClient } from './sharing'
import { createTabSync } from './store/tab-sync'
import { SyncStatusProvider } from './sync-status'
import { toasts } from './toasts'
import { AuthProvider } from './use-auth'
import '@manga/ui/tokens.css'
import '@manga/ui/base.css'

// 初回描画の前に当て、OS と違うテーマを選んだ人の画面がちらつかないようにする
applyThemePreference(readThemePreference())

const container = document.getElementById('root')
if (!container) throw new Error('#root がない')

const platform = detectPlatform()
const baseUrl = readApiBaseUrl()
const auth = createAuthClient({
  baseUrl,
  tokenStore: platform === 'desktop' ? createDesktopTokenStore() : undefined,
})
void auth.restore()

const local = createStorage(defaultStorageKind(platform))
// 未ログインの間 getToken は null を返し、クラウドストレージはローカルだけで動く
const cloud =
  baseUrl === ''
    ? null
    : createCloudStorage({ baseUrl, local, getToken: auth.getToken, fetch: auth.fetch })
const storage = cloud ?? local
const sharing = createSharingClient({
  baseUrl,
  fetch: auth.fetch,
  // CloudStorage はクラウドの id を同期の URL（/v1/projects/<id>/sync）でだけ外に出す
  cloudId: async (id) => {
    const url = (await cloud?.syncUrl(id)) ?? null
    return url === null ? null : decodeURIComponent(new URL(url).pathname.split('/').at(-2) ?? '')
  },
})
// 本番の同期サーバにつなぐのは別タスクなので、e2e のビルドだけ同じブラウザのタブ同士でつなぐ
const library = createProjectLibrary(storage, {
  roleOf: sharing.role,
  ...(import.meta.env.VITE_COLLAB_TABS === '1' && {
    collaboration: {
      syncUrl: async (id: string) => `tab-sync:${id}`,
      ydocs: createIndexedDbYDocStore(),
      userName: 'タブ',
      createSocket: createTabSync(),
    },
  }),
})
const imageProvider = createImageProvider({ baseUrl, getToken: auth.getToken })
const generation = createPanelGeneration({ library, imageProvider })
const router = createAppRouter({ library, imageProvider, generation, sharing })

if (platform === 'desktop') {
  import('./desktop/shell')
    .then(({ startDesktopShell }) => startDesktopShell({ router, library }))
    .catch((e: unknown) => toasts.push(`メニューを作れません: ${String(e)}`))
}

// debounce 待ちの変更をタブを閉じる・隠す時点で書く。pagehide だけでは書き込みが終わる前にページが破棄されうる
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void library.flushAll()
})
window.addEventListener('pagehide', () => void library.flushAll())

createRoot(container).render(
  <StrictMode>
    <AuthProvider client={auth}>
      <SyncStatusProvider source={cloud}>
        <RouterProvider router={router} />
      </SyncStatusProvider>
    </AuthProvider>
  </StrictMode>,
)
