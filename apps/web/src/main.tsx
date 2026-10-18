import { m } from '@manga/i18n'
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
import { createAuthClient, takeSignInError } from './auth'
import { createDesktopTokenStore } from './desktop/desktop-store'
import { createPanelGeneration } from './generate-panel'
import { createImageProvider, readApiBaseUrl } from './image-provider'
import { createLlmProvider } from './llm-provider'
import { createProjectLibrary } from './project-library'
import { errorMessage } from './route-error'
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

// ルーターが URL を読む前に外す
const signInError = takeSignInError(new URL(window.location.href))
if (signInError) {
  window.history.replaceState(window.history.state, '', signInError.url)
  toasts.push(signInError.message)
}

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
    : createCloudStorage({
        baseUrl,
        local,
        getToken: auth.getToken,
        fetch: auth.fetch,
        onError: (e) => toasts.push(m.web_cloud_save_failed({ reason: errorMessage(e) })),
      })
const storage = cloud ?? local
const sharing = createSharingClient({
  baseUrl,
  fetch: auth.fetch,
  cloudId: async (id) => (await cloud?.cloudId(id)) ?? null,
})
// 本番の同期サーバにつなぐのは別タスクなので、e2e のビルドだけ同じブラウザのタブ同士でつなぐ
const library = createProjectLibrary(storage, {
  roleOf: sharing.role,
  ...(import.meta.env.VITE_COLLAB_TABS === '1' && {
    collaboration: {
      syncUrl: async (id: string) => `tab-sync:${id}`,
      ydocs: createIndexedDbYDocStore(),
      userName: m.web_collab_tab_user(),
      createSocket: createTabSync(),
    },
  }),
})
const imageProvider = createImageProvider({ baseUrl, getToken: auth.getToken })
const llmProvider = createLlmProvider({ baseUrl, getToken: auth.getToken })
const generation = createPanelGeneration({ library, imageProvider })
const router = createAppRouter({
  library,
  imageProvider,
  llmProvider,
  generation,
  sharing,
  auth,
})
// 一覧に並ぶクラウドだけのプロジェクトとロールはユーザーで変わるので、ログインとサインアウトで loader を読み直す
// トークンの取り直しでも通知が来るが、同じユーザーなら読み直さない
let userId = auth.getUser()?.id
auth.subscribe(() => {
  const next = auth.getUser()?.id
  if (next === userId) return
  userId = next
  void router.invalidate()
})

if (platform === 'desktop') {
  import('./desktop/shell')
    .then(({ startDesktopShell }) => startDesktopShell({ router, library }))
    .catch((e: unknown) => toasts.push(m.web_menu_build_failed({ reason: errorMessage(e) })))
}

// debounce 待ちの変更をタブを閉じる・隠す時点で書く。pagehide だけでは書き込みが終わる前にページが破棄されうる
// 隠したタブは閉じられたり別の端末に持ち替えられたりするので、クラウドへも 2 秒の debounce を待たずに送る
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void library.flushAll().then(() => cloud?.flush())
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
