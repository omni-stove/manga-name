import { useCallback, useEffect, useRef, useState } from 'react'

export type AssetState = { url: string } | { error: true }

type Resolve = (ref: string) => Promise<string>

// ページの切り替えでキャンバスを作り直しても、解決済みの URL をすぐ出して画像を読み直させない。
// resolveAsset ごとに持つのは、差し替えたら解決し直す約束を守るため
const resolvedBy = new WeakMap<Resolve, Map<string, AssetState>>()

function cacheOf(resolve: Resolve): Map<string, AssetState> {
  let cache = resolvedBy.get(resolve)
  if (!cache) {
    cache = new Map()
    resolvedBy.set(resolve, cache)
  }
  return cache
}

/**
 * 画像を読み込んでデコードし終えるまで待つ。<image> の href を差し替えたフレームで
 * デコードを待たせないため。デコードできなくても URL は返し、失敗は <image> の onError に任せる
 */
async function preload(url: string): Promise<void> {
  if (typeof Image === 'undefined') return
  const img = new Image()
  img.src = url
  if (typeof img.decode !== 'function') return
  await img.decode().catch(() => {})
}

/**
 * ref を resolveAsset で表示用 URL に解決して持つ。解決済みの ref は、キャンバスを作り直しても
 * resolveAsset が同じなら呼び直さない。URL はデコードを終えてから出す。
 * resolveAsset が差し替わったら解決し直す。失敗した ref は `{ error: true }` になる。
 * 返す markError は、URL は得られたが画像の読み込みに失敗したときに呼ぶ
 */
export function useAssetUrls(
  refs: readonly string[],
  resolveAsset: Resolve,
): { assets: ReadonlyMap<string, AssetState>; markError(ref: string): void } {
  const [assets, setAssets] = useState<ReadonlyMap<string, AssetState>>(
    () => new Map(cacheOf(resolveAsset)),
  )
  const requested = useRef(new Set<string>())
  const resolver = useRef(resolveAsset)
  const key = [...new Set(refs)].sort().join('\n')

  useEffect(() => {
    const cache = cacheOf(resolveAsset)
    if (resolver.current !== resolveAsset) {
      resolver.current = resolveAsset
      requested.current.clear()
      setAssets(new Map(cache))
    }
    let alive = true
    const settled = new Set<string>()
    const pending = (key === '' ? [] : key.split('\n')).filter((r) => !requested.current.has(r))
    const settle = (ref: string, state: AssetState) => {
      settled.add(ref)
      if (alive)
        setAssets((prev) => (prev.get(ref) === state ? prev : new Map(prev).set(ref, state)))
    }
    for (const ref of pending) {
      requested.current.add(ref)
      const hit = cache.get(ref)
      if (hit) {
        settle(ref, hit)
        continue
      }
      resolveAsset(ref)
        .then(async (url) => {
          await preload(url)
          const state = { url }
          cache.set(ref, state)
          settle(ref, state)
        })
        .catch(() => settle(ref, { error: true }))
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
