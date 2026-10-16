import { currentArt } from '@manga/schema'
import { useId, useMemo, useRef } from 'react'
import { PageLayer } from './page-layer'
import type { EditorCanvasProps } from './types'
import { useAssetUrls } from './use-asset-urls'
import { useViewport } from './use-viewport'
import { zoomOf } from './view'

// SVG の中では :hover を属性で書けないので、生成ボタンの出し入れだけスタイルシートにする
const STYLE = `
.ec-generate { opacity: 0; transition: opacity 120ms; }
.ec-panel:hover .ec-generate, .ec-generate:focus-visible { opacity: 1; }
`

/**
 * 1 ページを SVG で描くキャンバス。ユーザー単位はページの mm（`settings.pageSize`）で、
 * ズームとパンは viewBox で表す。ページの外側は灰色。
 * 焦点、ベクトル、診断、参考画像、手描きのレイヤーは枠だけ置き、中身は後のタスクで足す
 */
export function EditorCanvas(props: EditorCanvasProps) {
  const { page, settings, layers } = props
  const { w: pageW, h: pageH } = settings.pageSize
  const svgRef = useRef<SVGSVGElement>(null)
  const idPrefix = `ec${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const { view, base, spaceHeld, panning, handlers } = useViewport(svgRef, pageW, pageH)

  const refs = useMemo(
    () =>
      layers.art
        ? page.panels.flatMap((p) => {
            const ref = currentArt(p)?.ref
            return ref === undefined ? [] : [ref]
          })
        : [],
    [page.panels, layers.art],
  )
  const { assets, markError } = useAssetUrls(refs, props.resolveAsset)

  return (
    <svg
      ref={svgRef}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-zoom={zoomOf(view, base).toFixed(3)}
      style={{
        display: 'block',
        background: '#e5e5e5',
        touchAction: 'none',
        userSelect: 'none',
        cursor: panning ? 'grabbing' : spaceHeld ? 'grab' : undefined,
      }}
      {...handlers}
    >
      <title>ページ</title>
      <style>{STYLE}</style>
      {layers.reference && <g data-layer="reference" />}
      <PageLayer
        page={page}
        width={pageW}
        height={pageH}
        showArt={layers.art}
        assets={assets}
        generating={props.generating}
        selection={props.selection}
        idPrefix={idPrefix}
        onArtError={markError}
        onGenerate={props.onGenerate}
      />
      {layers.scribble && <g data-layer="scribble" />}
      {layers.hints && <g data-layer="hints" />}
      {layers.diagnosis && props.diagnosis !== null && <g data-layer="diagnosis" />}
    </svg>
  )
}
