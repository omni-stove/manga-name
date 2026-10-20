import { m } from '@manga/i18n'
import {
  currentArt,
  hasFrameLine,
  type Page,
  type Panel,
  type ProjectSettings,
  pageSizeOf,
  paintOrder,
  panelOutline,
} from '@manga/schema'
import { Suspense, use, useId } from 'react'
import styles from './page-thumbnail.module.css'

type ResolveAsset = (ref: string) => Promise<string>

// resolveAsset ごとに持つのは、差し替えたら解決し直す約束を守るため
const urlsBy = new WeakMap<ResolveAsset, Map<string, Promise<string | null>>>()

/**
 * `ref` を `resolve` で表示用 URL にする Promise。use() に渡す。同じ `resolve` と `ref` には同じ Promise を返す。
 * 解決できなかったら `null` で満ち、reject はしない。URL の解放は `resolve` を作った側が持つ
 */
function assetUrl(resolve: ResolveAsset, ref: string): Promise<string | null> {
  let cache = urlsBy.get(resolve)
  if (!cache) {
    cache = new Map()
    urlsBy.set(resolve, cache)
  }
  let url = cache.get(ref)
  if (!url) {
    // 別の端末のローカルにしか無い画像は解決できない。コマの塗りだけ残す
    url = resolve(ref).catch(() => null)
    cache.set(ref, url)
  }
  return url
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
  const ref = currentArt(panel)?.ref
  const fill = <polygon points={outlinePoints(panel, w, h)} className={styles.art} />
  if (ref === undefined) return fill
  return (
    <Suspense fallback={fill}>
      <PanelImage key={ref} panel={panel} w={w} h={h} url={assetUrl(resolveAsset, ref)} />
    </Suspense>
  )
}

function PanelImage({
  panel,
  w,
  h,
  url: loaded,
}: {
  panel: Panel
  w: number
  h: number
  url: Promise<string | null>
}) {
  const url = use(loaded)
  const clipId = `thumb${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const box = {
    x: panel.rect.x * w,
    y: panel.rect.y * h,
    width: panel.rect.w * w,
    height: panel.rect.h * h,
  }
  if (url === null) return <polygon points={outlinePoints(panel, w, h)} className={styles.art} />
  // 入れ子の svg ははみ出しを切るので、slice で埋めた絵がコマを囲む矩形の外に出ない。多角形のコマはさらに輪郭で切る
  return (
    <svg {...box} role="img" aria-label={m.web_thumbnail_panel_art()}>
      {panel.shape && (
        <clipPath id={clipId}>
          <polygon
            points={panel.shape.map((p) => `${p.x * box.width},${p.y * box.height}`).join(' ')}
          />
        </clipPath>
      )}
      <image
        href={url}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        clipPath={panel.shape && `url(#${clipId})`}
      />
    </svg>
  )
}

const outlinePoints = (panel: Panel, w: number, h: number) =>
  panelOutline(panel)
    .map((p) => `${p.x * w},${p.y * h}`)
    .join(' ')

/** ページのコマ割りを紙面（見開きなら 2 ページ分）の縦横比で描き、黒い地のページは紙を黒くする。絵が選ばれたコマは、`resolveAsset` で読めればその絵を、読めなければ塗りを描く */
export function PageThumbnail({
  page,
  pageSize,
  resolveAsset = noAsset,
}: {
  page: Page
  pageSize: ProjectSettings['pageSize']
  resolveAsset?: ResolveAsset
}) {
  const { w, h } = pageSizeOf(page, pageSize)
  return (
    <svg
      className={styles.thumbnail}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={m.web_thumbnail_layout()}
    >
      <rect
        width={w}
        height={h}
        className={page.ground === 'black' ? styles.blackPaper : styles.paper}
      />
      {/* 枠なしのコマは下に敷くので先に描き、枠ありのコマは紙の地でその絵を隠す */}
      {paintOrder(page.panels).map((panel) => (
        <g key={panel.id}>
          {panel.frame !== 'none' && (
            <polygon points={outlinePoints(panel, w, h)} className={styles.ground} />
          )}
          {panel.artId !== undefined && (
            <PanelArt panel={panel} w={w} h={h} resolveAsset={resolveAsset} />
          )}
          <polygon
            points={outlinePoints(panel, w, h)}
            className={hasFrameLine(panel.frame) ? styles.panel : styles.borderless}
          />
        </g>
      ))}
    </svg>
  )
}
