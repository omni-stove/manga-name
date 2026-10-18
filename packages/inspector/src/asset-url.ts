type Resolve = (ref: string) => Promise<string>

// resolveAsset ごとに持つのは、差し替えたら解決し直す約束を守るため
const urlsBy = new WeakMap<Resolve, Map<string, Promise<string | null>>>()

/**
 * ref を resolveAsset で表示用 URL にする Promise。use() に渡す。
 * 同じ resolveAsset と ref には同じ Promise を返すので、resolveAsset はそれぞれ 1 度しか呼ばない。
 * 解決に失敗したら `null` で満ち、reject はしない
 */
export function assetUrl(resolveAsset: Resolve, ref: string): Promise<string | null> {
  let cache = urlsBy.get(resolveAsset)
  if (!cache) {
    cache = new Map()
    urlsBy.set(resolveAsset, cache)
  }
  let url = cache.get(ref)
  if (!url) {
    url = resolveAsset(ref).catch(() => null)
    cache.set(ref, url)
  }
  return url
}
