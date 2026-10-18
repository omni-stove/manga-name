import type { Patch, Project } from '@manga/schema'
import { useCallback, useState } from 'react'
import { useStore } from 'zustand'
import { errorMessage } from './route-error'
import type { WebProjectStore } from './store/project-store-types'

export function useProject(store: WebProjectStore): Project {
  return useStore(store.state, (s) => s.project)
}

/**
 * patch を作って ProjectStore に入れる関数と、直前の失敗の文言を返す。
 * patch の組み立てか applyPatch が throw したら状態は変えず、文言に出して false を返す
 */
export function useApplyPatch(store: WebProjectStore) {
  const [error, setError] = useState<string>()
  const apply = useCallback(
    (label: string, build: (project: Project) => Patch): boolean => {
      try {
        store.applyPatch(build(store.get()), { source: 'user', label })
        setError(undefined)
        return true
      } catch (e) {
        setError(errorMessage(e))
        return false
      }
    },
    [store],
  )
  return { apply, error }
}
