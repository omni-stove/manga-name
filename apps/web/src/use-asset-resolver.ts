import { useEffect, useMemo, useState } from 'react'

/**
 * `resolve` を EditorCanvas や PageThumbnail の resolveAsset として渡せる形にする。
 * 返した URL を覚えておき、アンマウント時と `resolve` が差し替わった時に URL.revokeObjectURL で解放する。
 * 同じ ref は 2 度解決しない。EditorCanvas は resolveAsset の identity が変わると解決し直すので、同じ `resolve` には同じ関数を返す
 */
export function useAssetResolver(
  resolve: (ref: string) => Promise<string>,
): (ref: string) => Promise<string> {
  const [generation, setGeneration] = useState(0)
  const { cache, resolveAsset } = useMemo(() => {
    const cache = new Map<string, Promise<string>>()
    const resolveAsset = (ref: string) => {
      let url = cache.get(ref)
      if (!url) {
        url = resolve(ref)
        cache.set(ref, url)
        // 失敗した ref は次の呼び出しで解決し直す
        url.catch(() => cache.delete(ref))
      }
      return url
    }
    return { cache, resolveAsset }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolve, generation])

  useEffect(
    () => () => {
      for (const url of cache.values())
        url.then(
          (u) => URL.revokeObjectURL(u),
          () => {},
        )
      cache.clear()
      // 解放した URL を覚えた Promise が use() 側に残らないよう、別の関数に差し替える。StrictMode の cleanup 対策
      setGeneration((g) => g + 1)
    },
    [cache],
  )

  return resolveAsset
}
