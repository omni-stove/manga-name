import { useCallback, useEffect, useRef, useState } from 'react'

export type AssetState = { url: string } | { error: true }

/**
 * ref を resolveAsset で表示用 URL に解決して持つ。解決済みの ref は呼び直さない。
 * resolveAsset が差し替わったら解決し直す。失敗した ref は `{ error: true }` になる。
 * 返す markError は、URL は得られたが画像の読み込みに失敗したときに呼ぶ
 */
export function useAssetUrls(
  refs: readonly string[],
  resolveAsset: (ref: string) => Promise<string>,
): { assets: ReadonlyMap<string, AssetState>; markError(ref: string): void } {
  const [assets, setAssets] = useState<ReadonlyMap<string, AssetState>>(() => new Map())
  const requested = useRef(new Set<string>())
  const resolver = useRef(resolveAsset)
  const key = [...new Set(refs)].sort().join('\n')

  useEffect(() => {
    if (resolver.current !== resolveAsset) {
      resolver.current = resolveAsset
      requested.current.clear()
      setAssets(new Map())
    }
    let alive = true
    const settled = new Set<string>()
    const pending = (key === '' ? [] : key.split('\n')).filter((r) => !requested.current.has(r))
    const settle = (ref: string, state: AssetState) => {
      settled.add(ref)
      if (alive) setAssets((prev) => new Map(prev).set(ref, state))
    }
    for (const ref of pending) {
      requested.current.add(ref)
      resolveAsset(ref).then(
        (url) => settle(ref, { url }),
        () => settle(ref, { error: true }),
      )
    }
    return () => {
      alive = false
      // 結果を捨てた ref は次の effect で解決し直す。StrictMode の二重実行で取りこぼさないため
      for (const ref of pending) if (!settled.has(ref)) requested.current.delete(ref)
    }
  }, [key, resolveAsset])

  const markError = useCallback((ref: string) => {
    setAssets((prev) => new Map(prev).set(ref, { error: true }))
  }, [])

  return { assets, markError }
}
