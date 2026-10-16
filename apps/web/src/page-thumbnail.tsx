import { currentArt, type Page, type Panel, type ProjectSettings } from '@manga/schema'
import { useEffect, useState } from 'react'

type ResolveAsset = (ref: string) => Promise<string>

/**
 * `ref` を `resolve` で表示用 URL にし、使い終わったら解放する。解決できるまでと、解決できなかったときは undefined。
 */
function useAssetUrl(resolve: ResolveAsset, ref: string | undefined): string | undefined {
  const [resolved, setResolved] = useState<{ ref: string; url: string }>()
  useEffect(() => {
    if (ref === undefined) return
    let cancelled = false
    let url: string | undefined
    resolve(ref).then(
      (u) => {
        if (cancelled) {
          URL.revokeObjectURL(u)
          return
        }
        url = u
        setResolved({ ref, url: u })
      },
      () => {
        // 別の端末のローカルにしか無い画像は解決できない。コマの塗りだけ残す
      },
    )
    return () => {
      cancelled = true
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [resolve, ref])
  return resolved?.ref === ref ? resolved.url : undefined
}

const noAsset: ResolveAsset = () => Promise.reject(new Error('no asset resolver'))

/** コマの採用中の絵。読めるまでと読めないときはコマを塗る */
function PanelArt({
  panel,
  w,
  h,
  resolveAsset,
}: {
  panel: Panel
  w: number
  h: number
  resolveAsset: ResolveAsset
}) {
  const url = useAssetUrl(resolveAsset, currentArt(panel)?.ref)
  const box = {
    x: panel.rect.x * w,
    y: panel.rect.y * h,
    width: panel.rect.w * w,
    height: panel.rect.h * h,
  }
  if (url === undefined) return <rect {...box} className="page-thumbnail-art" />
  // 入れ子の svg ははみ出しを切るので、slice で埋めた絵がコマ枠の外に出ない
  return (
    <svg {...box}>
      <image href={url} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />
    </svg>
  )
}

/** ページのコマ割りを判型の縦横比で描く。絵が選ばれたコマは、`resolveAsset` で読めればその絵を、読めなければ塗りを描く */
export function PageThumbnail({
  page,
  pageSize,
  resolveAsset = noAsset,
}: {
  page: Page
  pageSize: ProjectSettings['pageSize']
  resolveAsset?: ResolveAsset
}) {
  const { w, h } = pageSize
  return (
    <svg className="page-thumbnail" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="コマ割り">
      <rect width={w} height={h} className="page-thumbnail-paper" />
      {page.panels.map((panel) =>
        panel.artId === undefined ? null : (
          <PanelArt key={panel.id} panel={panel} w={w} h={h} resolveAsset={resolveAsset} />
        ),
      )}
      {page.panels.map((panel) => (
        <rect
          key={panel.id}
          x={panel.rect.x * w}
          y={panel.rect.y * h}
          width={panel.rect.w * w}
          height={panel.rect.h * h}
          className="page-thumbnail-panel"
        />
      ))}
    </svg>
  )
}
