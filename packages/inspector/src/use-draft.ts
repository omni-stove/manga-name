import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 入力欄の下書き。`value` は保存済みの値で、`set` で下書きを変えると `delayMs` 後に `commit` に渡す。
 * `delayMs` が 0 なら `set` の中で即座に commit する。`null` なら `flush` まで commit しない。
 *
 * - 下書きが無いときに `value` が変わったら（Undo や別の画面の変更）下書きをそれに合わせる
 * - `flush` は待ちを切り上げて commit する。unmount でも flush するので、選択を切り替えても入力は落ちない
 */
export function useDraft<T>(
  value: T,
  commit: (next: T) => void,
  delayMs: number | null,
): { draft: T; set(next: T): void; flush(): void } {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  // flush の中で同期に読むため ref に持ち、描画で見るために state にも写す
  const [dirty, setDirty] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<{ value: T } | undefined>(undefined)
  const commitRef = useRef(commit)
  useEffect(() => {
    commitRef.current = commit
  })

  const flush = useCallback(() => {
    if (pending.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
    const { value } = pending.current
    pending.current = undefined
    setDirty(false)
    commitRef.current(value)
  }, [])

  if (!Object.is(seen, value)) {
    setSeen(value)
    if (!dirty) setDraft(value)
  }

  useEffect(() => flush, [flush])

  const set = useCallback(
    (next: T) => {
      setDraft(next)
      if (delayMs !== null && delayMs <= 0) {
        commitRef.current(next)
        return
      }
      pending.current = { value: next }
      setDirty(true)
      clearTimeout(timer.current)
      if (delayMs !== null) timer.current = setTimeout(flush, delayMs)
    },
    [delayMs, flush],
  )

  return { draft, set, flush }
}
