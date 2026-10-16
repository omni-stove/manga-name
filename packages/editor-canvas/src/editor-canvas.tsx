import { currentArt, type Page } from '@manga/schema'
import { useId, useMemo, useRef } from 'react'
import { bodyPath, bubbleGeometry } from './bubble-shape'
import { panelBox } from './hit-test'
import { PageLayer } from './page-layer'
import type { EditorCanvasProps, Selection } from './types'
import { useAssetUrls } from './use-asset-urls'
import { sameSelection, useSelection } from './use-selection'
import { useViewport } from './use-viewport'
import { zoomOf } from './view'

// SVG の中では :hover を属性で書けないので、生成ボタンの出し入れだけスタイルシートにする
const STYLE = `
.ec-generate { opacity: 0; pointer-events: none; transition: opacity 120ms; }
.ec-overlay:hover .ec-generate, .ec-generate:focus-visible { opacity: 1; pointer-events: auto; }
`

const HOVER = '#93c5fd'

/**
 * 1 ページを SVG で描くキャンバス。ユーザー単位はページの mm（`settings.pageSize`）で、
 * ズームとパンは viewBox で表す。ページの外側は灰色。
 * クリックで選択、ホバーで強調、Delete で削除、矢印キーで 0.01 刻みの移動。
 * Patch はページ root 基準で `onChange` に出し、Undo / Redo は持たない。
 * 焦点、ベクトル、診断、参考画像、手描きのレイヤーは枠だけ置き、中身は後のタスクで足す
 */
export function EditorCanvas(props: EditorCanvasProps) {
  const { page, settings, layers } = props
  const { w: pageW, h: pageH } = settings.pageSize
  const svgRef = useRef<SVGSVGElement>(null)
  const idPrefix = `ec${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const viewport = useViewport(svgRef, pageW, pageH)
  const { view, base, spaceHeld, panning } = viewport
  const selection = useSelection({
    page,
    width: pageW,
    height: pageH,
    view,
    panning,
    selection: props.selection,
    onChange: props.onChange,
    onSelect: props.onSelect,
  })
  const hovered = sameSelection(selection.hovered, props.selection) ? null : selection.hovered

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

  const cursor = panning
    ? 'grabbing'
    : spaceHeld
      ? 'grab'
      : selection.hovered !== null
        ? 'pointer'
        : undefined

  return (
    <svg
      ref={svgRef}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: 選択要素のキー操作を受けるためキャンバスにフォーカスを置く
      tabIndex={0}
      data-zoom={zoomOf(view, base).toFixed(3)}
      style={{
        display: 'block',
        background: '#e5e5e5',
        touchAction: 'none',
        userSelect: 'none',
        outline: 'none',
        cursor,
      }}
      onPointerEnter={viewport.handlers.onPointerEnter}
      onPointerLeave={() => {
        viewport.handlers.onPointerLeave()
        selection.handlers.onPointerLeave()
      }}
      onPointerDown={(e) => {
        viewport.handlers.onPointerDown(e)
        selection.handlers.onPointerDown(e)
      }}
      onPointerMove={(e) => {
        viewport.handlers.onPointerMove(e)
        selection.handlers.onPointerMove(e)
      }}
      onPointerUp={(e) => {
        viewport.handlers.onPointerUp(e)
        selection.handlers.onPointerUp(e)
      }}
      onPointerCancel={(e) => {
        viewport.handlers.onPointerCancel(e)
        selection.handlers.onPointerCancel()
      }}
      onKeyDown={selection.handlers.onKeyDown}
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
      <Highlight page={page} width={pageW} height={pageH} target={hovered} />
    </svg>
  )
}

/** ホバー中の要素の輪郭。選択中の要素には出さない */
function Highlight({
  page,
  width,
  height,
  target,
}: {
  page: Page
  width: number
  height: number
  target: Selection
}) {
  if (target === null) return null
  const stroke = {
    fill: 'none',
    stroke: HOVER,
    strokeWidth: 2,
    vectorEffect: 'non-scaling-stroke',
    pointerEvents: 'none',
  } as const
  if (target.kind === 'panel') {
    const panel = page.panels.find((p) => p.id === target.id)
    if (!panel) return null
    const box = panelBox(panel, width, height)
    return (
      <g data-layer="highlight" data-hovered-id={target.id}>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} {...stroke} />
      </g>
    )
  }
  if (target.kind === 'bubble') {
    for (const panel of page.panels) {
      const bubble = panel.bubbles.find((b) => b.id === target.id)
      if (!bubble) continue
      const d = bodyPath(bubble.shape, bubbleGeometry(bubble, panelBox(panel, width, height)))
      return (
        <g data-layer="highlight" data-hovered-id={target.id}>
          <path d={d} {...stroke} />
        </g>
      )
    }
  }
  return null
}
