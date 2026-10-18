import { useEffect, useMemo, useRef, useState } from 'react'

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
    // biome-ignore lint/correctness/useExhaustiveDependencies: generation は cache を作り直すためだけの依存
  }, [resolve, generation])

  const released = useRef<Map<string, Promise<string>> | null>(null)
  useEffect(() => {
    // StrictMode は cleanup 後に同じ cache で effect を再実行する。解放済みの URL を覚えた Promise が use() 側に残らないよう、その時だけ別の関数に差し替える
    if (released.current === cache) setGeneration((g) => g + 1)
    return () => {
      for (const url of cache.values())
        url.then(
          (u) => URL.revokeObjectURL(u),
          () => {},
        )
      cache.clear()
      released.current = cache
    }
  }, [cache])

  return resolveAsset
}
