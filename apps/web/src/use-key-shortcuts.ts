import { useEffect, useEffectEvent } from 'react'
import { isEditable } from './use-undo-shortcuts'

/**
 * 修飾キーなしの 1 キーで操作を呼ぶ。`bindings` のキーは `KeyboardEvent.key` を小文字にしたもの。
 * 入力欄の中、モーダルの中、押しっぱなしの繰り返しでは呼ばない
 */
export function useKeyShortcuts(bindings: Record<string, () => void>): void {
  // 毎描画で作り直す bindings でリスナーを付け直さないよう、Effect Event から最新を読む
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return
    if (isEditable(e.target) || inDialog(e.target)) return
    const run = bindings[e.key.toLowerCase()]
    if (!run) return
    e.preventDefault()
    run()
  })
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

function inDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('dialog') !== null
}
