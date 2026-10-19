import { m } from '@manga/i18n'
import type { Patch } from '@manga/schema'
import type { ProjectRole } from '../sharing'
import type { WebProjectStore } from './project-store-types'

const SCRIBBLES_PATH = /^\/episodes\/\d+\/pages\/\d+\/scribbles(\/|$)/

/** role が patch を当ててよいなら true。commenter はページの scribbles の中だけ、viewer は何も当てられない */
function patchAllowed(patch: Patch, role: ProjectRole): boolean {
  if (role === 'owner' || role === 'editor') return true
  return role === 'commenter' && patch.every((op) => SCRIBBLES_PATH.test(op.path))
}

/**
 * store の applyPatch に role の制限を掛けた store。許されない `user` と `ai` の patch は throw し、`remote` は通す。
 * サーバも同じ制限で書き込みを断るが、手元で先に止めないと、断られる変更が画面に残ってしまう
 */
export function restrictStore(store: WebProjectStore, role: ProjectRole): WebProjectStore {
  if (role === 'owner' || role === 'editor') return store
  return {
    ...store,
    applyPatch(patch, meta) {
      if (meta?.source !== 'remote' && !patchAllowed(patch, role)) {
        throw new Error(
          role === 'viewer' ? m.web_restricted_viewer() : m.web_restricted_commenter(),
        )
      }
      store.applyPatch(patch, meta)
    },
  }
}

if (import.meta.vitest) {
  const { describe, expect, test, vi } = import.meta.vitest

  const fakeStore = () => {
    const applyPatch = vi.fn<WebProjectStore['applyPatch']>()
    const undo = vi.fn()
    return { applyPatch, undo, store: { applyPatch, undo } as unknown as WebProjectStore }
  }
  const scribble: Patch = [{ op: 'add', path: '/episodes/0/pages/1/scribbles/-', value: {} }]
  const title: Patch = [{ op: 'replace', path: '/title', value: 't' }]

  describe('restrictStore', () => {
    test('owner and editor get the store itself', () => {
      const { store } = fakeStore()
      expect(restrictStore(store, 'owner')).toBe(store)
      expect(restrictStore(store, 'editor')).toBe(store)
    })

    test('a commenter can only change the scribbles of a page', () => {
      const { applyPatch, store } = fakeStore()
      const restricted = restrictStore(store, 'commenter')
      restricted.applyPatch(scribble)
      restricted.applyPatch([{ op: 'remove', path: '/episodes/2/pages/0/scribbles' }], {
        source: 'ai',
      })
      expect(applyPatch).toHaveBeenCalledTimes(2)
      expect(() => restricted.applyPatch(title)).toThrow(m.web_restricted_commenter())
      expect(() => restricted.applyPatch([...scribble, ...title])).toThrow()
      expect(() =>
        restricted.applyPatch([{ op: 'add', path: '/episodes/0/pages/1/scribblesX', value: 1 }]),
      ).toThrow()
      expect(applyPatch).toHaveBeenCalledTimes(2)
    })

    test('a viewer cannot change anything, but remote patches still apply', () => {
      const { applyPatch, store } = fakeStore()
      const restricted = restrictStore(store, 'viewer')
      expect(() => restricted.applyPatch(scribble)).toThrow(m.web_restricted_viewer())
      expect(() => restricted.applyPatch(title, { source: 'ai' })).toThrow(
        m.web_restricted_viewer(),
      )
      expect(applyPatch).not.toHaveBeenCalled()
      restricted.applyPatch(title, { source: 'remote' })
      expect(applyPatch).toHaveBeenCalledExactlyOnceWith(title, { source: 'remote' })
    })

    test('the other methods pass through to the store', () => {
      const { undo, store } = fakeStore()
      restrictStore(store, 'viewer').undo()
      expect(undo).toHaveBeenCalledOnce()
    })
  })
}
