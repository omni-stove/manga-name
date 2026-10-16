import { currentArt, type Page, type Stroke } from '@manga/schema'
import { memo, useId, useMemo, useRef } from 'react'
import { bodyPath, bubbleGeometry } from './bubble-shape'
import { panelBox } from './hit-test'
import { PageLayer } from './page-layer'
import { PanelToolLayer } from './panel-tool-layer'
import type { EditorCanvasProps, Selection } from './types'
import { useAssetUrls } from './use-asset-urls'
import { usePanelTool } from './use-panel-tool'
import { polylinePoints, SCRIBBLE_WIDTH, useScribble } from './use-scribble'
import { sameSelection, useSelection } from './use-selection'
import { useViewport } from './use-viewport'
import { zoomOf } from './view'

// SVG の中では :hover を属性で書けないので、生成ボタンの出し入れだけスタイルシートにする
const STYLE = `
.ec-generate { opacity: 0; pointer-events: none; transition: opacity 120ms; }
.ec-overlay:hover .ec-generate, .ec-generate:focus-visible { opacity: 1; pointer-events: auto; }
`

const HOVER = '#93c5fd'

const SCRIBBLE_COLORS: Record<Stroke['color'], string> = {
  ink: '#1f2937',
  red: '#dc2626',
  blue: '#2563eb',
}

const IDLE_POINTER = { onPointerDown() {}, onPointerMove() {} }

/**
 * 1 ページを SVG で描くキャンバス。ユーザー単位はページの mm（`settings.pageSize`）で、
 * ズームとパンは viewBox で表す。ページの外側は灰色。
 * クリックで選択、ホバーで強調、Delete で削除、矢印キーで 0.01 刻みの移動。
 * `panel` ツールではドラッグでコマを作り、選択中のコマをハンドルでリサイズ、ボタンで分割、
 * Shift + クリックで結合する。端は他のコマとページの端に 0.01 以内で吸い付く。
 * Patch はページ root 基準で `onChange` に 1 操作 1 回出し、Undo / Redo は持たない。
 * 参考画像はページの白地の上、コマの下に描く。
 * `scribble` ツールでは手描きの線を引き、消しゴムで 1 本ずつ消す。手描きのレイヤーが非表示なら何もしない。
 * 焦点、ベクトル、診断のレイヤーは枠だけ置き、中身は後のタスクで足す
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
  const panelTool = usePanelTool({
    page,
    width: pageW,
    height: pageH,
    view,
    panning,
    tool: props.tool,
    direction: settings.direction,
    selection: props.selection,
    onChange: props.onChange,
    onSelect: props.onSelect,
  })
  const liveRef = useRef<SVGPolylineElement>(null)
  const scribbleTool = props.scribbleTool ?? 'ink'
  const scribble = useScribble({
    page,
    width: pageW,
    height: pageH,
    view,
    tool: scribbleTool,
    liveRef,
    onChange: props.onChange,
  })
  const scribbleSelected = props.tool === 'scribble'
  const scribbling = scribbleSelected && layers.scribble
  const pointer = scribbling
    ? scribble.handlers
    : scribbleSelected
      ? IDLE_POINTER
      : selection.handlers
  const hovered =
    scribbleSelected ||
    panelTool.draft !== null ||
    sameSelection(selection.hovered, props.selection)
      ? null
      : selection.hovered

  const referenceRef = layers.reference ? page.reference?.ref : undefined
  const refs = useMemo(() => {
    const arts = layers.art
      ? page.panels.flatMap((p) => {
          const ref = currentArt(p)?.ref
          return ref === undefined ? [] : [ref]
        })
      : []
    return referenceRef === undefined ? arts : [referenceRef, ...arts]
  }, [page.panels, layers.art, referenceRef])
  const { assets, markError } = useAssetUrls(refs, props.resolveAsset)

  const cursor = panning
    ? 'grabbing'
    : spaceHeld
      ? 'grab'
      : props.tool === 'panel' || scribbling
        ? 'crosshair'
        : !scribbleSelected && selection.hovered !== null
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
        panelTool.handlers.onPointerDown(e)
        pointer.onPointerDown(e)
      }}
      onPointerMove={(e) => {
        viewport.handlers.onPointerMove(e)
        panelTool.handlers.onPointerMove(e)
        pointer.onPointerMove(e)
      }}
      onPointerUp={(e) => {
        viewport.handlers.onPointerUp(e)
        panelTool.handlers.onPointerUp(e)
        // 押している間にツールが切り替わっても、各フックの状態が取り残されないよう両方に渡す
        selection.handlers.onPointerUp(e)
        scribble.handlers.onPointerUp(e)
      }}
      onPointerCancel={(e) => {
        viewport.handlers.onPointerCancel(e)
        panelTool.handlers.onPointerCancel(e)
        selection.handlers.onPointerCancel()
        scribble.handlers.onPointerCancel(e)
      }}
      onKeyDown={(e) => {
        if (!panelTool.handlers.onKeyDown(e)) selection.handlers.onKeyDown(e)
      }}
    >
      <title>ページ</title>
      <style>{STYLE}</style>
      <PageLayer
        page={page}
        width={pageW}
        height={pageH}
        showArt={layers.art}
        showReference={layers.reference}
        assets={assets}
        generating={props.generating}
        selection={props.selection}
        idPrefix={idPrefix}
        onArtError={markError}
        onGenerate={props.onGenerate}
      />
      {layers.scribble && (
        <g data-layer="scribble" pointerEvents="none">
          <Scribbles scribbles={page.scribbles} width={pageW} height={pageH} />
          {scribbling && (
            <polyline
              ref={liveRef}
              data-live-stroke
              fill="none"
              stroke={SCRIBBLE_COLORS[scribbleTool === 'eraser' ? 'ink' : scribbleTool]}
              strokeWidth={SCRIBBLE_WIDTH * pageW}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      )}
      {layers.hints && <g data-layer="hints" />}
      {layers.diagnosis && props.diagnosis !== null && <g data-layer="diagnosis" />}
      <Highlight page={page} width={pageW} height={pageH} target={hovered} />
      <PanelToolLayer
        selected={panelTool.selected}
        draft={panelTool.draft}
        width={pageW}
        height={pageH}
        handleSize={panelTool.handleSize}
        onSplit={panelTool.split}
      />
    </svg>
  )
}

/** 手描きの線。描いている間は再描画しないよう scribbles が変わったときだけ描き直す */
const Scribbles = memo(function Scribbles({
  scribbles,
  width,
  height,
}: {
  scribbles: Stroke[]
  width: number
  height: number
}) {
  return scribbles.map((stroke) => (
    <polyline
      key={stroke.id}
      data-stroke-id={stroke.id}
      points={polylinePoints(stroke.points, width, height)}
      fill="none"
      stroke={SCRIBBLE_COLORS[stroke.color]}
      strokeWidth={stroke.width * width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ))
})

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
