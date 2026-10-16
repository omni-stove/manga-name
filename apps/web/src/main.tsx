import { createCloudStorage, createStorage, defaultStorageKind } from '@manga/storage'
import { applyThemePreference, readThemePreference } from '@manga/ui'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createAuthClient } from './auth'
import { createPanelGeneration } from './generate-panel'
import { createImageProvider, readApiBaseUrl } from './image-provider'
import { createProjectLibrary } from './project-library'
import { createAppRouter } from './router'
import { AuthProvider } from './use-auth'
import '@manga/ui/tokens.css'
import '@manga/ui/base.css'

// 初回描画の前に当て、OS と違うテーマを選んだ人の画面がちらつかないようにする
applyThemePreference(readThemePreference())

const container = document.getElementById('root')
if (!container) throw new Error('#root がない')

const baseUrl = readApiBaseUrl()
const auth = createAuthClient({ baseUrl })
void auth.restore()

const local = createStorage(defaultStorageKind())
// 未ログインの間 getToken は null を返し、クラウドストレージはローカルだけで動く
const storage =
  baseUrl === ''
    ? local
    : createCloudStorage({ baseUrl, local, getToken: auth.getToken, fetch: auth.fetch })
const library = createProjectLibrary(storage)
const imageProvider = createImageProvider({ baseUrl, getToken: auth.getToken })
const generation = createPanelGeneration({ library, imageProvider })

// debounce 待ちの変更をタブを閉じる・隠す時点で書く。pagehide だけでは書き込みが終わる前にページが破棄されうる
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void library.flushAll()
})
window.addEventListener('pagehide', () => void library.flushAll())

createRoot(container).render(
  <StrictMode>
    <AuthProvider client={auth}>
      <RouterProvider router={createAppRouter({ library, imageProvider, generation })} />
    </AuthProvider>
  </StrictMode>,
)
