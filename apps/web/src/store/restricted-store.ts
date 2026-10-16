import type { Patch } from '@manga/schema'
import type { ProjectRole } from '../sharing'
import type { WebProjectStore } from './project-store'

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
          role === 'viewer'
            ? '閲覧のみのプロジェクトは変更できません'
            : 'このプロジェクトで書けるのは手描きメモだけです',
        )
      }
      store.applyPatch(patch, meta)
    },
  }
}
