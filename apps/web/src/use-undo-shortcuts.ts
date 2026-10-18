import { useEffect } from 'react'
import type { ProjectStore } from './store/project-store-types'

// 押すだけの input は文字を受けないので、フォーカスがあってもショートカットを効かせる
const PRESSABLE_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset']

/** 入力欄の中か。Undo / Redo を入力欄自身の取り消しに任せる判定に使う */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.tagName === 'INPUT') {
    return !PRESSABLE_INPUTS.includes((target as HTMLInputElement).type)
  }
  return target.isContentEditable || ['TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Cmd / Ctrl + Z で Undo、Shift を足すか Ctrl + Y で Redo。
 * テキスト入力の中では入力欄自身の取り消しに任せる。`enabled` が false の間は受けない
 */
export function useUndoShortcuts(store: ProjectStore, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || isEditable(e.target)) return
      const k = e.key.toLowerCase()
      const redo = (k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey)
      if (!redo && !(k === 'z' && !e.shiftKey)) return
      e.preventDefault()
      if (redo) store.redo()
      else store.undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store, enabled])
}
