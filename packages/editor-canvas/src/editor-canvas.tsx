import { m } from '@manga/i18n'
import type { ID, Page, Stroke } from '@manga/schema'
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
} from 'react'
import { bodyPath, bubbleGeometry } from './bubble-shape'
import { BubbleToolLayer } from './bubble-tool-layer'
import { DiagnosisLayer } from './diagnosis-layer'
import { FrameLayer } from './frame-layer'
import { GhostLayer } from './ghost-layer'
import { findFocus, findVector, focusRadius, toPagePoint } from './hint-ops'
import { HintsLayer } from './hints-layer'
import { panelBox, panelPolygon, polygonPoints } from './hit-test'
import { PageLayer } from './page-layer'
import { PanelToolLayer } from './panel-tool-layer'
import type { EditorCanvasProps, Selection } from './types'
import { useBubbleTool } from './use-bubble-tool'
import { useHintTool } from './use-hint-tool'
import { useLongPress } from './use-long-press'
import { useMove } from './use-move'
import { usePanelTool } from './use-panel-tool'
import { polylinePoints, SCRIBBLE_WIDTH, useScribble } from './use-scribble'
import { type ClientPoint, sameSelection, useSelection } from './use-selection'
import { useViewport } from './use-viewport'
import { zoomOf } from './view'

// SVG の中では :hover を属性で書けないので、生成ボタンの出し入れだけスタイルシートにする
const STYLE = `
.ec-generate { opacity: 0; pointer-events: none; transition: opacity 120ms; }
.ec-overlay:hover .ec-generate, .ec-generate:focus-visible { opacity: 1; pointer-events: auto; }
[data-layer="panel-tool"] [role="button"]:focus:not(:focus-visible) { outline: none; }
`

const HOVER = 'var(--guide-soft)'

const SCRIBBLE_COLORS: Record<Stroke['color'], string> = {
  ink: '#1f2937',
  red: '#dc2626',
  blue: '#2563eb',
}

// 赤入れの黒と見分けられるよう、下描きは鉛筆の色にする
const SKETCH_COLOR = '#64748b'

const IDLE_POINTER = { onPointerDown() {}, onPointerMove() {} }

/**
 * 1 ページを SVG で描くキャンバス。ユーザー単位はページの mm（`settings.pageSize`）で、
 * ズームとパンは viewBox で表す。ページの外側は作業台の色（`--surface-desk`）。
 * クリックで選択、ホバーで強調、Delete で削除、矢印キーで 0.01 刻みの移動。
 * `select` ツールでは選択中のコマかフキダシをドラッグで動かす。
 * `panel` ツールと手描きの最中を除き、要素の無いところ（作業台とコマの外）のドラッグでページを動かす。
 * 右クリックは押した要素を選んでから `onContextMenu` に渡す。手描きの最中を除き、タッチの長押しも右クリックとして扱う。
 * `panel` ツールではドラッグでコマを作り、選択中のコマをハンドルでリサイズ、ボタンで縦横に分割、
 * 「線で分割」か Alt + ドラッグで引いた斜めの線で分割、「結合」か Shift + クリックで押したコマと結合する。多角形のコマは
 * 頂点をドラッグで動かし、矩形のコマも Alt + 隅のドラッグで頂点を動かせる。
 * 端は他のコマとページの端に 0.01 以内で吸い付き、頂点は他のコマの頂点にも吸い付く。
 * `bubble` ツールではコマのクリックでフキダシを作り、ドラッグで移動、隅のハンドルでリサイズ、
 * しっぽの先端のドラッグでしっぽを動かす。セリフは縦書きで、収まらなければ末尾を省略記号にする。
 * Patch はページ root 基準で `onChange` に 1 操作 1 回出し、Undo / Redo は持たない。
 * `focus` ツールではクリックで焦点を置き、ドラッグで動かす。`vector` ツールではドラッグでベクトルを作り、
 * 終点（と始点）が焦点かフキダシの上なら `targetFocusId`（と `sourceFocusId`）を付ける。
 * `layers.frames` が立っていれば、タチキリ枠、外枠、内枠をコマの上に重ねる。
 * 参考画像はページの白地の上、コマの下に描く。焦点とベクトルはフキダシの上に描き、
 * `layers.hints` を切ると描画も選択も操作もしない。
 * `scribble` ツールでは手描きの線を引き、消しゴムで 1 本ずつ消す。手描きのレイヤーが非表示なら何もしない。
 * `sketch` ツールも同じ操作で、線は `Page.sketch` に足す。下描きのレイヤーが非表示なら何もしない。
 * `diagnosis` があり `layers.diagnosis` が立っていれば、視線経路、bubble chain、焦点ごとの診断ラベル、
 * ページ下の集計行と凡例を重ねる。そのとき焦点の素のラベルは診断ラベルに譲る。
 * `ghostPage` があれば、AI の提案で動く焦点とフキダシ、増えるベクトルを元の位置と提案の位置の両方で重ねる。
 * 作業用の色は `@manga/ui/tokens.css` の変数を参照するので、使う側でそれを読み込んでおく
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
    hints: layers.hints,
    selection: props.selection,
    onChange: props.onChange,
    onSelect: props.onSelect,
  })
  const hintTool = useHintTool({
    page,
    width: pageW,
    height: pageH,
    view,
    panning,
    tool: props.tool,
    focusKind: props.focusKind ?? 'face',
    enabled: layers.hints,
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
  const bubbleTool = useBubbleTool({
    page,
    width: pageW,
    height: pageH,
    view,
    panning,
    tool: props.tool,
    selection: props.selection,
    onChange: props.onChange,
    onSelect: props.onSelect,
  })
  const move = useMove({
    page,
    width: pageW,
    height: pageH,
    view,
    panning,
    active: props.tool === 'select',
    selection: props.selection,
    hitAt: selection.hitAt,
    onChange: props.onChange,
  })
  const liveRef = useRef<SVGPolylineElement>(null)
  const scribbleTool = props.scribbleTool ?? 'ink'
  const scribble = useScribble({
    page,
    key: 'scribbles',
    width: pageW,
    height: pageH,
    view,
    tool: scribbleTool,
    liveRef,
    onChange: props.onChange,
  })
  const sketchLiveRef = useRef<SVGPolylineElement>(null)
  const sketch = useScribble({
    page,
    key: 'sketch',
    width: pageW,
    height: pageH,
    view,
    tool: props.sketchTool === 'eraser' ? 'eraser' : 'ink',
    liveRef: sketchLiveRef,
    onChange: props.onChange,
  })
  const scribbleSelected = props.tool === 'scribble' || props.tool === 'sketch'
  const diagnosis = layers.diagnosis ? props.diagnosis : null
  const scribbling =
    (props.tool === 'scribble' && layers.scribble) || (props.tool === 'sketch' && layers.sketch)
  const pointer = scribbling
    ? props.tool === 'sketch'
      ? sketch.handlers
      : scribble.handlers
    : scribbleSelected
      ? IDLE_POINTER
      : selection.handlers
  const hovered =
    scribbleSelected ||
    panelTool.draft !== null ||
    bubbleTool.draft !== null ||
    hintTool.draft !== null ||
    move.panelDraft !== null ||
    move.bubbleDraft !== null ||
    sameSelection(selection.hovered, props.selection)
      ? null
      : selection.hovered

  // 親が毎回作り直す onGenerate で PageLayer の memo が外れないよう、identity を固定して最新を呼ぶ
  const onGenerateRef = useRef(props.onGenerate)
  useLayoutEffect(() => {
    onGenerateRef.current = props.onGenerate
  })
  const generate = useCallback((panelId: ID) => onGenerateRef.current?.(panelId), [])

  const openMenu = (at: ClientPoint) => {
    if (!props.onContextMenu) return
    // メニューを閉じたときにフォーカスがキャンバスへ戻り、続けて Delete や矢印キーが効くようにする
    at.currentTarget.focus({ preventScroll: true })
    const target = selection.hitAt(at)
    if (target !== null && !sameSelection(target, props.selection)) props.onSelect(target)
    props.onContextMenu({ x: at.clientX, y: at.clientY, target, fit: viewport.fit })
  }
  const longPress = useLongPress((el, at) =>
    openMenu({ currentTarget: el, clientX: at.x, clientY: at.y }),
  )
  const cancelPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
    viewport.handlers.onPointerCancel(e)
    panelTool.handlers.onPointerCancel(e)
    bubbleTool.handlers.onPointerCancel(e)
    hintTool.handlers.onPointerCancel(e)
    move.handlers.onPointerCancel(e)
    selection.handlers.onPointerCancel()
    scribble.handlers.onPointerCancel(e)
    sketch.handlers.onPointerCancel(e)
  }

  const cursor = panning
    ? 'grabbing'
    : spaceHeld
      ? 'grab'
      : props.tool === 'panel' || hintTool.active || scribbling
        ? 'crosshair'
        : props.tool === 'bubble'
          ? selection.hovered?.kind === 'bubble'
            ? 'move'
            : 'crosshair'
          : move.panelDraft !== null ||
              move.bubbleDraft !== null ||
              (props.tool === 'select' &&
                (selection.hovered?.kind === 'panel' || selection.hovered?.kind === 'bubble') &&
                sameSelection(selection.hovered, props.selection))
            ? 'move'
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
        background: 'var(--surface-desk)',
        touchAction: 'none',
        userSelect: 'none',
        // iPad Safari は接頭辞付きしか効かず、1 本指の長押しで選択や吹き出しメニューが出て描画が止まる
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        outline: 'none',
        cursor,
      }}
      onPointerEnter={viewport.handlers.onPointerEnter}
      onPointerLeave={() => {
        viewport.handlers.onPointerLeave()
        selection.handlers.onPointerLeave()
      }}
      onPointerDown={(e) => {
        if (props.onContextMenu && !scribbling) longPress.onPointerDown(e)
        viewport.handlers.onPointerDown(e)
        panelTool.handlers.onPointerDown(e)
        bubbleTool.handlers.onPointerDown(e)
        hintTool.handlers.onPointerDown(e)
        move.handlers.onPointerDown(e)
        pointer.onPointerDown(e)
        // panel ツールは何も無いところのドラッグでコマを作り、手描きはどこからでも線を引くので、パンに回さない
        if (props.tool !== 'panel' && !scribbling && selection.hitAt(e) === null) {
          viewport.panFromPress(e)
        }
      }}
      onPointerMove={(e) => {
        // 長押しはタイマーで発火し、各フックへ取り消しを渡せるイベントが無いので、その後の最初のイベントで渡す
        if (longPress.held(e)) {
          cancelPointer(e)
          return
        }
        longPress.onPointerMove(e)
        viewport.handlers.onPointerMove(e)
        panelTool.handlers.onPointerMove(e)
        bubbleTool.handlers.onPointerMove(e)
        hintTool.handlers.onPointerMove(e)
        move.handlers.onPointerMove(e)
        pointer.onPointerMove(e)
      }}
      onPointerUp={(e) => {
        // メニューを開いた指を離しても、クリックやドラッグの確定にしない
        if (longPress.end(e)) {
          cancelPointer(e)
          return
        }
        viewport.handlers.onPointerUp(e)
        panelTool.handlers.onPointerUp(e)
        bubbleTool.handlers.onPointerUp(e)
        hintTool.handlers.onPointerUp(e)
        move.handlers.onPointerUp(e)
        // 押している間にツールが切り替わっても、各フックの状態が取り残されないよう両方に渡す
        selection.handlers.onPointerUp(e)
        scribble.handlers.onPointerUp(e)
        sketch.handlers.onPointerUp(e)
      }}
      onPointerCancel={(e) => {
        longPress.end(e)
        cancelPointer(e)
      }}
      onContextMenu={(e) => {
        if (!props.onContextMenu) return
        e.preventDefault()
        if (!longPress.contextMenu()) openMenu(e)
      }}
      onKeyDown={(e) => {
        if (
          panelTool.handlers.onKeyDown(e) ||
          bubbleTool.handlers.onKeyDown(e) ||
          hintTool.handlers.onKeyDown(e) ||
          move.handlers.onKeyDown(e)
        ) {
          return
        }
        selection.handlers.onKeyDown(e)
      }}
    >
      <title>{m.page()}</title>
      <style>{STYLE}</style>
      <PageLayer
        page={page}
        width={pageW}
        height={pageH}
        showArt={layers.art}
        showReference={layers.reference}
        resolveAsset={props.resolveAsset}
        generating={props.generating}
        generatingPage={props.generatingPage ?? false}
        selection={props.selection}
        idPrefix={idPrefix}
        onGenerate={props.onGenerate ? generate : undefined}
      />
      {layers.frames && <FrameLayer width={pageW} height={pageH} />}
      {layers.sketch && (
        <g data-layer="sketch" pointerEvents="none">
          <Scribbles
            scribbles={page.sketch ?? NO_STROKES}
            width={pageW}
            height={pageH}
            color={SKETCH_COLOR}
          />
          {scribbling && props.tool === 'sketch' && (
            <polyline
              ref={sketchLiveRef}
              data-live-stroke
              fill="none"
              stroke={SKETCH_COLOR}
              strokeWidth={SCRIBBLE_WIDTH * pageW}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      )}
      {layers.scribble && (
        <g data-layer="scribble" pointerEvents="none">
          <Scribbles scribbles={page.scribbles} width={pageW} height={pageH} />
          {scribbling && props.tool === 'scribble' && (
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
      {layers.hints && (
        <HintsLayer
          page={page}
          width={pageW}
          height={pageH}
          selection={props.selection}
          draft={hintTool.draft}
          labels={diagnosis === null}
        />
      )}
      {diagnosis !== null && (
        <DiagnosisLayer page={page} diagnosis={diagnosis} width={pageW} height={pageH} />
      )}
      {props.ghostPage && (
        <GhostLayer page={page} ghost={props.ghostPage} width={pageW} height={pageH} />
      )}
      <Highlight page={page} width={pageW} height={pageH} target={hovered} />
      <PanelToolLayer
        selected={panelTool.selected}
        draft={panelTool.draft ?? move.panelDraft}
        width={pageW}
        height={pageH}
        handleSize={panelTool.handleSize}
        cutting={panelTool.cutting}
        merging={panelTool.merging}
        onSplit={panelTool.split}
        onToggleCut={panelTool.toggleCut}
        onToggleMerge={panelTool.toggleMerge}
      />
      <BubbleToolLayer
        selected={bubbleTool.selected}
        draft={bubbleTool.draft ?? move.bubbleDraft}
        handleSize={bubbleTool.handleSize}
      />
    </svg>
  )
}

// sketch が無いページで毎回新しい空配列を渡し、Scribbles の memo を外さない
const NO_STROKES: Stroke[] = []

/**
 * 手描きの線。描いている間は再描画しないよう scribbles が変わったときだけ描き直す。
 * color を渡すと Stroke.color の代わりにその色で描く
 */
const Scribbles = memo(function Scribbles({
  scribbles,
  width,
  height,
  color,
}: {
  scribbles: Stroke[]
  width: number
  height: number
  color?: string
}) {
  return scribbles.map((stroke) => (
    <StrokeLine key={stroke.id} stroke={stroke} width={width} height={height} color={color} />
  ))
})

// 1 本足すたびに 500 本の points 文字列を作り直すと 1 フレームに収まらないので、Patch で変わらなかった線は描き直さない
const StrokeLine = memo(function StrokeLine({
  stroke,
  width,
  height,
  color,
}: {
  stroke: Stroke
  width: number
  height: number
  color?: string
}) {
  return (
    <polyline
      data-stroke-id={stroke.id}
      points={polylinePoints(stroke.points, width, height)}
      fill="none"
      stroke={color ?? SCRIBBLE_COLORS[stroke.color]}
      strokeWidth={stroke.width * width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
})

// React Compiler 1.0 が Highlight の中の Math.max でコード生成に失敗するので、コンポーネントの外で計算する
function highlightRadius(weight: number): number {
  return Math.max(focusRadius(weight), 1.5)
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
  // var() は CSS の値なので、表示属性ではなく style で渡す
  const stroke = {
    fill: 'none',
    style: { stroke: HOVER },
    strokeWidth: 2,
    vectorEffect: 'non-scaling-stroke',
    pointerEvents: 'none',
  } as const
  if (target.kind === 'panel') {
    const panel = page.panels.find((p) => p.id === target.id)
    if (!panel) return null
    return (
      <g data-layer="highlight" data-hovered-id={target.id}>
        <polygon points={polygonPoints(panelPolygon(panel, width, height))} {...stroke} />
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
    return null
  }
  if (target.kind === 'focus') {
    const at = findFocus(page, target.id)
    const focus = at?.panel.focusPoints[at.index]
    if (!at || !focus) return null
    const c = toPagePoint(at.panel, width, height, focus.pos)
    return (
      <g data-layer="highlight" data-hovered-id={target.id}>
        <circle cx={c.x} cy={c.y} r={highlightRadius(focus.weight)} {...stroke} />
      </g>
    )
  }
  const at = findVector(page, target.id)
  const vector = at?.panel.vectors[at.index]
  if (!at || !vector) return null
  const from = toPagePoint(at.panel, width, height, vector.from)
  const to = toPagePoint(at.panel, width, height, vector.to)
  return (
    <g data-layer="highlight" data-hovered-id={target.id}>
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        {...stroke}
        strokeWidth={5}
        strokeOpacity={0.6}
      />
    </g>
  )
}
