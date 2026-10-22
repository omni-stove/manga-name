import { useState } from 'react'

/**
 * localStorage の `key` に覚えておく真偽値。覚えが無ければ `initial` から始め、変えるたびに書き戻す。
 * パネルの開閉のように、次に開いたときも同じ状態にしたい UI の状態に使う
 */
export function useStoredFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    const stored = readStorage(key)
    return stored === null ? initial : stored === 'true'
  })
  return [
    value,
    (next) => {
      setValue(next)
      writeStorage(key, String(next))
    },
  ]
}

/**
 * localStorage の `key` に覚えておく幅（px）。覚えが無い、または `undefined` を渡したら覚えを消して
 * `undefined` を返す。ドラッグで変えたパネルの幅のように、既定の幅へ戻せる値に使う
 */
export function useStoredWidth(
  key: string,
): [number | undefined, (value: number | undefined) => void] {
  const [value, setValue] = useState(() => {
    const stored = Number(readStorage(key) ?? Number.NaN)
    return Number.isFinite(stored) ? stored : undefined
  })
  return [
    value,
    (next) => {
      setValue(next)
      if (next === undefined) removeStorage(key)
      else writeStorage(key, String(next))
    },
  ]
}

// ストレージを塞いだブラウザでは参照だけで SecurityError になるので、覚えられないまま動かす
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {}
}
