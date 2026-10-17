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

// ストレージを塞いだブラウザでは参照だけで SecurityError になるので、覚えられないまま動かす
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {}
}
