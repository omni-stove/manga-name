import { createStorage } from '@manga/storage'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createProjectLibrary } from './project-library'
import { createAppRouter } from './router'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root がない')

const library = createProjectLibrary(createStorage('indexeddb'))

// debounce 待ちの変更をタブを閉じる・隠す時点で書く。pagehide だけでは書き込みが終わる前にページが破棄されうる
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void library.flushAll()
})
window.addEventListener('pagehide', () => void library.flushAll())

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={createAppRouter({ library })} />
  </StrictMode>,
)
