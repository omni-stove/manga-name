export type AssetState = { url: string } | { error: true }

type Resolve = (ref: string) => Promise<string>

// ページの切り替えでキャンバスを作り直しても、解決済みの Promise をそのまま use() に渡して画像を読み直させない。
// resolveAsset ごとに持つのは、差し替えたら解決し直す約束を守るため
const loadedBy = new WeakMap<Resolve, Map<string, Promise<AssetState>>>()

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
 * ref を resolveAsset で表示用 URL に解決し、デコードし終えたら満ちる Promise。use() に渡す。
 * 同じ resolveAsset と ref には同じ Promise を返すので、resolveAsset はそれぞれ 1 度しか呼ばない。
 * 解決に失敗したら `{ error: true }` で満ち、reject はしない
 */
export function loadAsset(resolveAsset: Resolve, ref: string): Promise<AssetState> {
  let cache = loadedBy.get(resolveAsset)
  if (!cache) {
    cache = new Map()
    loadedBy.set(resolveAsset, cache)
  }
  let loaded = cache.get(ref)
  if (!loaded) {
    loaded = resolveAsset(ref).then(
      async (url) => {
        await preload(url)
        return { url }
      },
      () => ({ error: true }) as const,
    )
    cache.set(ref, loaded)
  }
  return loaded
}
