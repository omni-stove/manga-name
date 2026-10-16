import { useEffect, useRef, useState } from 'react'

/**
 * ref を resolveAsset で表示用 URL にして持つ。解決できなかった ref は `null`。
 * 解決済みの ref は呼び直さない。resolveAsset が差し替わったら解決し直す
 */
export function useAssetUrls(
  refs: readonly string[],
  resolveAsset: (ref: string) => Promise<string>,
): ReadonlyMap<string, string | null> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string | null>>(() => new Map())
  const requested = useRef({ resolveAsset, refs: new Set<string>() })
  const key = [...new Set(refs)].sort().join('\n')

  useEffect(() => {
    if (requested.current.resolveAsset !== resolveAsset) {
      requested.current = { resolveAsset, refs: new Set() }
      setUrls(new Map())
    }
    let alive = true
    const wanted = key === '' ? [] : key.split('\n')
    const pending = wanted.filter((ref) => !requested.current.refs.has(ref))
    const settled = new Set<string>()
    for (const ref of pending) {
      requested.current.refs.add(ref)
      resolveAsset(ref).then(
        (url) => {
          settled.add(ref)
          if (alive) setUrls((prev) => new Map(prev).set(ref, url))
        },
        () => {
          settled.add(ref)
          if (alive) setUrls((prev) => new Map(prev).set(ref, null))
        },
      )
    }
    return () => {
      alive = false
      // 結果を捨てた ref は次の effect で解決し直す。StrictMode の二重実行で取りこぼさないため
      for (const ref of pending) if (!settled.has(ref)) requested.current.refs.delete(ref)
    }
  }, [key, resolveAsset])

  return urls
}
