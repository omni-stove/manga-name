// @vitest-environment jsdom
import { m } from '@manga/i18n'
import {
  type Bubble,
  type ID,
  type Page,
  type Panel,
  type Patch,
  pageSizeOf,
  type Stroke,
} from '@manga/schema'
import {
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
} from 'react'
import type { Root } from 'react-dom/client'
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
 * 1 ページを SVG で描くキャンバス。ユーザー単位は紙面の mm（`settings.pageSize`、見開きなら幅が 2 倍）で、
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
  const { w: pageW, h: pageH } = pageSizeOf(page, settings.pageSize)
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
      {layers.frames && <FrameLayer page={page} width={pageW} height={pageH} />}
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

if (import.meta.vitest) {
  const { afterEach, describe, expect, test, vi } = import.meta.vitest
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { BubbleSchema, fixtures, INNER_FRAME, panelOutline } = await import('@manga/schema')
  const { LONG_PRESS_MS } = await import('./use-long-press')
  const { fitView } = await import('./view')

  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  const project = fixtures.samplePage01
  const samplePage = project.episodes[0]?.pages[0] as Page

  const fixtureArtUrl = (panelId: string) =>
    new URL(`../../../fixtures/art/${panelId}.png`, import.meta.url).href

  /** 全コマに fixtures/art/<panelId>.png を採用したページ */
  const pageWithArts: Page = {
    ...samplePage,
    panels: samplePage.panels.map((panel) => ({
      ...panel,
      arts: [
        {
          id: `art_${panel.id}`,
          ref: `file:art/${panel.id}.png`,
          provider: 'fake',
          prompt: 'p',
          createdAt: '2026-10-16T00:00:00.000Z',
        },
      ],
      artId: `art_${panel.id}`,
    })),
  }

  const resolveFixture = (ref: string) =>
    Promise.resolve(fixtureArtUrl(ref.replace(/^file:art\//, '').replace(/\.png$/, '')))

  const defaults: EditorCanvasProps = {
    page: samplePage,
    settings: project.settings,
    characters: project.characters,
    diagnosis: null,
    selection: null,
    tool: 'select',
    layers: {
      reference: true,
      art: true,
      scribble: true,
      sketch: true,
      hints: true,
      diagnosis: true,
      frames: true,
    },
    generating: new Set(),
    onChange: () => {},
    onSelect: () => {},
    resolveAsset: resolveFixture,
  }

  const roots: Root[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount())
    document.body.replaceChildren()
  })

  function must<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) throw new Error('missing')
    return value
  }

  async function mount(props: EditorCanvasProps) {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<EditorCanvas {...props} />))
    return { svg: must(container.querySelector('svg')), root }
  }

  async function render(overrides: Partial<EditorCanvasProps> = {}) {
    return (await mount({ ...defaults, ...overrides })).svg
  }

  describe('drawing the fixture', () => {
    test('six panels, three bubbles, vertical dialogue', async () => {
      const svg = await render()
      expect(svg.querySelectorAll('[data-panel-id]')).toHaveLength(6)
      expect(svg.querySelectorAll('[data-panel-number]')).toHaveLength(6)
      expect(svg.querySelectorAll('[data-bubble-id]')).toHaveLength(3)
      const lines = [...svg.querySelectorAll('text[writing-mode="vertical-rl"]')]
      expect(lines).toHaveLength(3)
      expect(lines.map((t) => t.textContent).sort()).toEqual(['……', '……？', '……芽が'].sort())
    })

    test('legible dialogue gets no alert', async () => {
      const svg = await render()
      expect(svg.querySelectorAll('[data-bubble-alert]')).toHaveLength(0)
    })

    test('a locked panel or bubble shows a lock under its number', async () => {
      expect((await render()).querySelectorAll('[data-locked]')).toHaveLength(0)
      const page: Page = {
        ...samplePage,
        panels: samplePage.panels.map((panel) => ({
          ...panel,
          locked: panel.id === 'pn_2' || undefined,
          bubbles: panel.bubbles.map((b) => (b.id === 'bb_3' ? { ...b, locked: true } : b)),
        })),
      }
      const svg = await render({ page })
      expect(svg.querySelectorAll('[data-locked]')).toHaveLength(2)
      expect(
        svg.querySelector('[data-panel-id="pn_2"] [data-panel-number] [data-locked]'),
      ).not.toBeNull()
      expect(svg.querySelector('[data-bubble-id="bb_3"] [data-locked]')).not.toBeNull()
    })

    /** pn_3 の唯一のフキダシ bb_3 を差し替えたページ */
    const withBubble3 = (patch: Partial<Panel['bubbles'][number]>): Page => ({
      ...samplePage,
      panels: samplePage.panels.map((panel) =>
        panel.id === 'pn_3'
          ? { ...panel, bubbles: panel.bubbles.map((b) => ({ ...b, ...patch })) }
          : panel,
      ),
    })

    test('dialogue too long for its bubble gets an alert with a readable label', async () => {
      const svg = await render({ page: withBubble3({ text: 'あ'.repeat(200) }) })
      const alert = must(svg.querySelector('[data-bubble-id="bb_3"] [data-bubble-alert]'))
      expect(alert.getAttribute('role')).toBe('img')
      expect(alert.getAttribute('aria-label')).toBe(m.editor_canvas_bubble_text_truncated())
    })

    test('dialogue of a bubble cut by the panel edge sits in the visible part', async () => {
      const svg = await render({ page: withBubble3({ pos: { x: 1, y: 0.5 }, tail: undefined }) })
      const panel = must(samplePage.panels.find((p) => p.id === 'pn_3'))
      const edge = (panel.rect.x + panel.rect.w) * project.settings.pageSize.w
      const columns = [...svg.querySelectorAll('[data-bubble-id="bb_3"] tspan')]
      expect(columns.length).toBeGreaterThan(0)
      for (const column of columns) expect(Number(column.getAttribute('x'))).toBeLessThan(edge)
    })

    test('dialogue of a bubble past the inner frame sits inside the inner frame', async () => {
      // bb_1 は裁ち切りのコマ pn_1 の右端寄りに置かれ、本体が内枠の右に出ている
      const svg = await render()
      const edge = (INNER_FRAME.x + INNER_FRAME.w) * project.settings.pageSize.w
      const columns = [...svg.querySelectorAll('[data-bubble-id="bb_1"] tspan')]
      expect(columns.length).toBeGreaterThan(0)
      for (const column of columns) expect(Number(column.getAttribute('x'))).toBeLessThan(edge)
    })

    test('panels without art show camera and note in grey, and no image', async () => {
      const svg = await render()
      expect(svg.querySelectorAll('image')).toHaveLength(0)
      const first = must(svg.querySelector('[data-panel-id="pn_1"] [data-placeholder]'))
      expect(first.textContent).toContain('[ロング]')
      expect(first.textContent).toContain('ガラス結晶の森')
    })

    test('a black panel is filled black and the dialogue of an unpainted bubble in it is white', async () => {
      const [pn1, ...rest] = samplePage.panels as [Panel, ...Panel[]]
      const bubble = BubbleSchema.parse({
        id: 'bb_black',
        order: 9,
        text: '……',
        shape: 'none',
        pos: { x: 0.5, y: 0.5 },
        size: { w: 0.3, h: 0.5 },
      })
      const page = {
        ...samplePage,
        panels: [{ ...pn1, fill: 'black' as const, bubbles: [bubble] }, ...rest],
      }
      const svg = await render({ page })
      expect(svg.querySelector('[data-panel-id="pn_1"] [data-panel-fill="black"]')).not.toBeNull()
      expect(svg.querySelector('[data-panel-id="pn_2"] [data-panel-fill]')).toBeNull()
      const text = must(svg.querySelector('[data-bubble-id="bb_black"] text[writing-mode]'))
      expect(text.getAttribute('fill')).toBe('#fff')
    })

    test('a borderless panel is drawn first with a dashed guide outline, and framed panels get a white ground', async () => {
      const [pn1, ...rest] = samplePage.panels as [Panel, ...Panel[]]
      const background = { ...pn1, id: 'pn_bg', order: 99, frame: 'none' as const }
      const page = { ...samplePage, panels: [pn1, ...rest, background] }
      const svg = await render({ page })
      const ids = [...svg.querySelectorAll('[data-layer="page"] > [data-panel-id]')].map((g) =>
        g.getAttribute('data-panel-id'),
      )
      expect(ids[0]).toBe('pn_bg')
      const frame = must(svg.querySelector('[data-panel-id="pn_bg"] > [data-panel-frame="none"]'))
      expect(frame.getAttribute('stroke-dasharray')).not.toBeNull()
      expect(svg.querySelector('[data-panel-id="pn_bg"] [data-panel-fill="white"]')).toBeNull()
      expect(svg.querySelector('[data-panel-id="pn_1"] [data-panel-fill="white"]')).not.toBeNull()

      const plain = await render({ page: samplePage })
      expect(plain.querySelector('[data-panel-fill="white"]')).toBeNull()
    })

    test('a black-ground page paints the paper black and gives framed panels a white ground', async () => {
      const svg = await render({ page: { ...samplePage, ground: 'black' } })
      expect(must(svg.querySelector('[data-ground]')).getAttribute('fill')).toBe('#000')
      expect(svg.querySelectorAll('[data-panel-fill="white"]')).toHaveLength(
        samplePage.panels.length,
      )
    })

    test('frame styles shape the outline, dash or double the line, and soften the edge', async () => {
      const frames = ['round', 'wavy', 'dashed', 'double', 'soft'] as const
      const page = {
        ...samplePage,
        panels: samplePage.panels.map((p, i) => (frames[i] ? { ...p, frame: frames[i] } : p)),
      }
      const svg = await render({ page })
      const frameOf = (id: string) =>
        must(svg.querySelector<SVGElement>(`[data-panel-id="${id}"] > [data-panel-frame]`))
      const corners = (id: string) => frameOf(id).getAttribute('points')?.split(' ').length
      expect(corners('pn_1')).toBeGreaterThan(4)
      expect(corners('pn_2')).toBeGreaterThan(4)
      expect(corners('pn_6')).toBe(4)
      expect(frameOf('pn_3').getAttribute('stroke-dasharray')).toBe('6 3')
      expect(frameOf('pn_4').getAttribute('stroke-width')).toBe('3')
      expect(frameOf('pn_5').style.stroke).toBe('var(--guide)')
      expect(svg.querySelector('[data-panel-id="pn_5"] [data-soft-edge]')).not.toBeNull()
    })

    test('the selected panel gets a guide-coloured frame', async () => {
      const svg = await render({ selection: { kind: 'panel', id: 'pn_2' } })
      const frame = must(
        svg.querySelector<SVGPolygonElement>('[data-panel-id="pn_2"] > polygon[data-selected]'),
      )
      expect(frame.style.stroke).toBe('var(--guide)')
    })
  })

  describe('art', () => {
    test('the page tone filters the arts through the tone matrix', async () => {
      const svg = await render({ page: { ...pageWithArts, tone: 'sepia' } })
      const filter = must(svg.querySelector('filter[data-tone="sepia"]'))
      const image = must(svg.querySelector('[data-panel-id="pn_1"] image'))
      expect(image.getAttribute('filter')).toBe(`url(#${filter.id})`)
    })

    test('arts are drawn as <image> clipped to the panel', async () => {
      const resolveAsset = vi.fn(resolveFixture)
      const svg = await render({ page: pageWithArts, resolveAsset })
      const images = [...svg.querySelectorAll('image')]
      expect(images).toHaveLength(6)
      expect(resolveAsset).toHaveBeenCalledTimes(6)
      for (const panel of pageWithArts.panels) {
        const image = must(svg.querySelector(`[data-panel-id="${panel.id}"] image`))
        expect(image.getAttribute('href')).toBe(fixtureArtUrl(panel.id))
        expect(image.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice')
        const id = must(image.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/)?.[1])
        const clip = must(svg.querySelector(`clipPath[id="${id}"] polygon`))
        expect(clip.getAttribute('points')).toBe(polygonPointsOf(panel))
      }
    })

    test('a failed resolve falls back to the placeholder with an error', async () => {
      const svg = await render({
        page: pageWithArts,
        resolveAsset: (ref) =>
          ref.includes('pn_3') ? Promise.reject(new Error('gone')) : resolveFixture(ref),
      })
      expect(svg.querySelectorAll('image')).toHaveLength(5)
      const panel = must(svg.querySelector('[data-panel-id="pn_3"]'))
      expect(panel.querySelector('[data-art-error]')).not.toBeNull()
      expect(panel.textContent).toContain(m.editor_canvas_panel_image_load_failed())
    })

    test('layers.art = false hides art without resolving it', async () => {
      const resolveAsset = vi.fn(resolveFixture)
      const svg = await render({
        page: pageWithArts,
        resolveAsset,
        layers: { ...defaults.layers, art: false },
      })
      expect(svg.querySelectorAll('image')).toHaveLength(0)
      expect(resolveAsset).not.toHaveBeenCalled()
    })
  })

  describe('reference image', () => {
    const referenceUrl = 'blob:reference'
    const withReference = (reference: Page['reference']): Partial<EditorCanvasProps> => ({
      page: { ...pageWithArts, reference },
      resolveAsset: (ref) =>
        ref === 'blob:ref' ? Promise.resolve(referenceUrl) : resolveFixture(ref),
    })

    test('is drawn below every panel, fitted to the page, with opacity and visibility', async () => {
      const svg = await render(withReference({ ref: 'blob:ref', opacity: 0.3, visible: true }))
      const images = [...svg.querySelectorAll('image')]
      expect(images).toHaveLength(7)
      const first = must(images[0])
      expect(first.getAttribute('href')).toBe(referenceUrl)
      expect(first.closest('[data-layer="reference"]')).not.toBeNull()
      expect(first.getAttribute('x')).toBe('0')
      expect(first.getAttribute('y')).toBe('0')
      expect(first.getAttribute('width')).toBe(String(project.settings.pageSize.w))
      expect(first.getAttribute('height')).toBe(String(project.settings.pageSize.h))
      expect(first.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
      expect(first.getAttribute('opacity')).toBe('0.3')
      expect(first.getAttribute('visibility')).toBe('visible')
      const layer = must(svg.querySelector('[data-layer="reference"]'))
      const firstPanel = must(svg.querySelector('[data-panel-id]'))
      expect(
        layer.compareDocumentPosition(firstPanel) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    test('visible = false keeps the image hidden', async () => {
      const svg = await render(withReference({ ref: 'blob:ref', opacity: 0.5, visible: false }))
      const image = must(svg.querySelector('[data-layer="reference"] image'))
      expect(image.getAttribute('visibility')).toBe('hidden')
    })

    test('layers.reference = false hides it without resolving it', async () => {
      const resolveAsset = vi.fn(resolveFixture)
      const svg = await render({
        page: { ...samplePage, reference: { ref: 'blob:ref', opacity: 0.5, visible: true } },
        resolveAsset,
        layers: { ...defaults.layers, reference: false },
      })
      expect(svg.querySelector('[data-layer="reference"]')).toBeNull()
      expect(resolveAsset).not.toHaveBeenCalled()
    })
  })

  test('panels in generating get a spinner', async () => {
    const svg = await render({ generating: new Set(['pn_2', 'pn_5']) })
    expect(svg.querySelectorAll('[data-spinner]')).toHaveLength(2)
    expect(svg.querySelector('[data-overlay-panel-id="pn_2"] [data-spinner]')).not.toBeNull()
    expect(svg.querySelector('[data-overlay-panel-id="pn_5"] [data-spinner]')).not.toBeNull()
    expect(svg.querySelector('[data-overlay-panel-id="pn_1"] [data-spinner]')).toBeNull()
  })

  test('the generate button calls onGenerate and is hidden while generating', async () => {
    const onGenerate = vi.fn()
    const svg = await render({ onGenerate, generating: new Set(['pn_1']) })
    expect(svg.querySelector('[data-overlay-panel-id="pn_1"] .ec-generate')).toBeNull()
    const button = must(svg.querySelector('[data-overlay-panel-id="pn_4"] .ec-generate'))
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onGenerate).toHaveBeenCalledWith('pn_4')
  })

  test('a page generated in one call gets one spinner over the page and no generate buttons', async () => {
    const svg = await render({
      onGenerate: vi.fn(),
      generating: new Set(['pn_1', 'pn_2']),
      generatingPage: true,
    })
    expect(svg.querySelectorAll('[data-spinner]')).toHaveLength(1)
    expect(svg.querySelector('[data-overlay-panel-id] [data-spinner]')).toBeNull()
    expect(svg.querySelector('.ec-generate')).toBeNull()
  })

  const base = fitView(project.settings.pageSize.w, project.settings.pageSize.h)

  /** base と同じ縦横比で 2px / mm になる大きさに固定する */
  function layout(svg: SVGSVGElement) {
    const width = base.w * 2
    const height = base.h * 2
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, x: 0, y: 0, width, height, right: width, bottom: height }) as DOMRect
  }

  /** layout 後の、正規化ページ座標に対応する画面座標 */
  const clientAt = (nx: number, ny: number) => ({
    x: (nx * project.settings.pageSize.w - base.x) * 2,
    y: (ny * project.settings.pageSize.h - base.y) * 2,
  })

  const viewBox = (svg: SVGSVGElement) => must(svg.getAttribute('viewBox')).split(' ').map(Number)

  function pointer(
    type: string,
    init: {
      id: number
      x: number
      y: number
      button?: number
      pointerType?: string
      shiftKey?: boolean
      altKey?: boolean
    },
  ) {
    // jsdom の PointerEvent の有無に依存しないよう、MouseEvent に pointer の属性を足す
    const e = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: init.button ?? 0,
      shiftKey: init.shiftKey ?? false,
      altKey: init.altKey ?? false,
      clientX: init.x,
      clientY: init.y,
    })
    Object.defineProperties(e, {
      pointerId: { value: init.id },
      pointerType: { value: init.pointerType ?? 'mouse' },
    })
    return e
  }

  const fire = (target: EventTarget, e: Event) =>
    act(() => {
      target.dispatchEvent(e)
    })

  /** 画面座標 at でクリックする */
  function click(svg: SVGSVGElement, at: { x: number; y: number }) {
    fire(svg, pointer('pointerdown', { id: 1, ...at }))
    fire(svg, pointer('pointerup', { id: 1, ...at }))
  }

  const key = (svg: SVGSVGElement, init: KeyboardEventInit) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    fire(svg, e)
    return e
  }

  describe('selection', () => {
    test('clicking a panel, a bubble and the background selects each', async () => {
      const onSelect = vi.fn()
      const svg = await render({ onSelect })
      layout(svg)
      click(svg, clientAt(0.75, 0.4))
      expect(onSelect).toHaveBeenLastCalledWith({ kind: 'panel', id: 'pn_2' })
      click(svg, clientAt(0.85 * 0.48, 0.275 + 0.25 * 0.23))
      expect(onSelect).toHaveBeenLastCalledWith({ kind: 'bubble', id: 'bb_3' })
      // 何も選んでいないときに背景を押しても、選択は変わらないので知らせない
      click(svg, { x: -10, y: -10 })
      expect(onSelect).toHaveBeenCalledTimes(2)
    })

    test('clicking the background with a selection selects nothing', async () => {
      const onSelect = vi.fn()
      const svg = await render({ onSelect, selection: { kind: 'bubble', id: 'bb_3' } })
      layout(svg)
      click(svg, { x: -10, y: -10 })
      expect(onSelect).toHaveBeenCalledWith(null)
    })

    test('a drag and a Space pan do not select', async () => {
      const onSelect = vi.fn()
      const svg = await render({ onSelect })
      layout(svg)
      const from = clientAt(0.75, 0.4)
      fire(svg, pointer('pointerdown', { id: 1, ...from }))
      fire(svg, pointer('pointermove', { id: 1, x: from.x + 30, y: from.y }))
      fire(svg, pointer('pointerup', { id: 1, x: from.x + 30, y: from.y }))
      fire(svg, pointer('pointerover', { id: 1, ...from }))
      fire(window, new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true }))
      click(svg, from)
      fire(window, new KeyboardEvent('keyup', { code: 'Space', key: ' ' }))
      expect(onSelect).not.toHaveBeenCalled()
    })

    test('hovering highlights the element under the cursor, but not the selected one', async () => {
      const svg = await render({ selection: { kind: 'panel', id: 'pn_2' } })
      layout(svg)
      const highlighted = () =>
        svg.querySelector('[data-layer="highlight"]')?.getAttribute('data-hovered-id') ?? null
      fire(svg, pointer('pointermove', { id: 1, ...clientAt(0.5, 0.1) }))
      expect(highlighted()).toBe('pn_1')
      fire(svg, pointer('pointermove', { id: 1, ...clientAt(0.75, 0.4) }))
      expect(highlighted()).toBeNull()
      fire(svg, pointer('pointermove', { id: 1, ...clientAt(0.92, 0.22 * 0.26) }))
      expect(highlighted()).toBe('bb_1')
      expect(svg.querySelector('[data-layer="highlight"] path')).not.toBeNull()
      // React の onPointerLeave は pointerout で判定する
      fire(svg, pointer('pointerout', { id: 1, x: -10, y: -10 }))
      expect(highlighted()).toBeNull()
    })
  })

  describe('editing the selection from the keyboard', () => {
    test('Delete emits a remove patch rooted at the page and clears the selection', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ onChange, onSelect, selection: { kind: 'panel', id: 'pn_6' } })
      const e = key(svg, { key: 'Delete' })
      expect(e.defaultPrevented).toBe(true)
      expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/panels/5' }])
      expect(onSelect).toHaveBeenCalledWith(null)
    })

    test('Backspace removes a bubble inside its panel', async () => {
      const onChange = vi.fn()
      const svg = await render({ onChange, selection: { kind: 'bubble', id: 'bb_6' } })
      key(svg, { key: 'Backspace' })
      expect(onChange).toHaveBeenCalledWith([
        { op: 'remove', path: '/panels/5/vectors/0/sourceFocusId' },
        { op: 'remove', path: '/panels/5/bubbles/0' },
      ])
    })

    test('arrow keys move by 0.01, Shift by 0.1, and stay inside the page', async () => {
      const onChange = vi.fn()
      const svg = await render({ onChange, selection: { kind: 'panel', id: 'pn_2' } })
      key(svg, { key: 'ArrowDown' })
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'replace', path: '/panels/1/rect/y', value: 0.285 },
      ])
      key(svg, { key: 'ArrowLeft', shiftKey: true })
      expect(onChange).toHaveBeenLastCalledWith([
        { op: 'replace', path: '/panels/1/rect/x', value: 0.4 },
      ])
      key(svg, { key: 'ArrowRight' })
      expect(onChange).toHaveBeenCalledTimes(2)
    })

    test('a bubble moves with its tail', async () => {
      const onChange = vi.fn()
      const svg = await render({ onChange, selection: { kind: 'bubble', id: 'bb_3' } })
      key(svg, { key: 'ArrowUp' })
      expect(onChange).toHaveBeenCalledWith([
        { op: 'replace', path: '/panels/2/bubbles/0/pos/y', value: 0.24 },
        { op: 'replace', path: '/panels/2/bubbles/0/tail/y', value: 0.37 },
      ])
    })

    test('Escape clears the selection; keys from inner controls and without a selection do nothing', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ onChange, onSelect, onGenerate: () => {} })
      key(svg, { key: 'Delete' })
      key(svg, { key: 'ArrowRight' })
      expect(onChange).not.toHaveBeenCalled()
      const button = must(svg.querySelector('.ec-generate'))
      act(() => {
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
      })
      expect(onChange).not.toHaveBeenCalled()
      key(svg, { key: 'Escape' })
      expect(onSelect).not.toHaveBeenCalled()
    })

    test('Escape with a selection selects nothing', async () => {
      const onSelect = vi.fn()
      const svg = await render({ onSelect, selection: { kind: 'bubble', id: 'bb_1' } })
      key(svg, { key: 'Escape' })
      expect(onSelect).toHaveBeenCalledWith(null)
    })
  })

  /** 画面座標 from から to へドラッグする。途中の 1 点も通る */
  function drag(
    svg: SVGSVGElement,
    from: { x: number; y: number },
    to: { x: number; y: number },
    opts: { release?: boolean } = {},
  ) {
    fire(svg, pointer('pointerdown', { id: 1, ...from }))
    fire(svg, pointer('pointermove', { id: 1, x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }))
    fire(svg, pointer('pointermove', { id: 1, ...to }))
    if (opts.release ?? true) fire(svg, pointer('pointerup', { id: 1, ...to }))
  }

  const polygonPointsOf = (panel: Panel) => {
    const { w, h } = project.settings.pageSize
    return panelOutline(panel)
      .map((p) => `${p.x * w},${p.y * h}`)
      .join(' ')
  }

  const patchOf = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls[0]?.[0] as Patch

  describe('panel tool', () => {
    test('a drag creates one snapped panel on pointerup and selects it', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'panel', onChange, onSelect })
      layout(svg)
      const to = clientAt(0.495, 0.497)
      drag(svg, clientAt(0.2, 0.3), to, { release: false })
      expect(svg.querySelector('[data-draft="new"]')).not.toBeNull()
      expect(onChange).not.toHaveBeenCalled()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(onChange).toHaveBeenCalledTimes(1)
      const patch = patchOf(onChange)
      // 右端は pn_2 の左端 0.5、下端は pn_2 / pn_3 の下端 0.505 へ吸い付く
      expect(patch).toEqual([
        {
          op: 'add',
          path: '/panels/6',
          value: expect.objectContaining({ order: 7, rect: { x: 0.2, y: 0.3, w: 0.3, h: 0.205 } }),
        },
      ])
      expect(onSelect).toHaveBeenCalledWith({
        kind: 'panel',
        id: (patch[0] as { value: Panel }).value.id,
      })
      expect(svg.querySelector('[data-draft]')).toBeNull()
    })

    test('a click still selects, and the select tool does not create panels', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'panel', onChange, onSelect })
      layout(svg)
      click(svg, clientAt(0.75, 0.4))
      expect(onSelect).toHaveBeenCalledWith({ kind: 'panel', id: 'pn_2' })
      expect(onChange).not.toHaveBeenCalled()

      const select = await render({ tool: 'select', onChange })
      layout(select)
      drag(select, clientAt(0.2, 0.3), clientAt(0.4, 0.45))
      expect(onChange).not.toHaveBeenCalled()
    })

    test('a handle drag resizes with one patch and snaps to the neighbour', async () => {
      const onChange = vi.fn()
      const svg = await render({
        tool: 'panel',
        onChange,
        selection: { kind: 'panel', id: 'pn_2' },
      })
      layout(svg)
      expect(svg.querySelectorAll('[data-handle]')).toHaveLength(8)
      // pn_2 の左辺の中点から、pn_3 の右端 0.48 の 0.005 手前まで
      drag(svg, clientAt(0.5, 0.39), clientAt(0.485, 0.39), { release: false })
      expect(svg.querySelector('[data-draft="pn_2"]')).not.toBeNull()
      expect(onChange).not.toHaveBeenCalled()
      fire(svg, pointer('pointerup', { id: 1, ...clientAt(0.485, 0.39) }))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(patchOf(onChange)).toEqual([
        {
          op: 'replace',
          path: '/panels/1',
          value: expect.objectContaining({
            id: 'pn_2',
            rect: { x: 0.48, y: 0.275, w: 0.52, h: 0.23 },
          }),
        },
      ])
    })

    test('the split button splits with one patch and renumbers orders rtl', async () => {
      const onChange = vi.fn()
      const svg = await render({
        tool: 'panel',
        onChange,
        selection: { kind: 'panel', id: 'pn_2' },
      })
      const button = must(svg.querySelector('[data-split="vertical"]'))
      act(() => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(patchOf(onChange)).toEqual([
        {
          op: 'replace',
          path: '/panels/1',
          value: expect.objectContaining({
            id: 'pn_2',
            order: 2,
            rect: { x: 0.76, y: 0.275, w: 0.24, h: 0.23 },
          }),
        },
        {
          op: 'add',
          path: '/panels/2',
          value: expect.objectContaining({
            order: 3,
            rect: { x: 0.5, y: 0.275, w: 0.24, h: 0.23 },
          }),
        },
        { op: 'replace', path: '/panels/3/order', value: 4 },
        { op: 'replace', path: '/panels/4/order', value: 5 },
        { op: 'replace', path: '/panels/5/order', value: 6 },
        { op: 'replace', path: '/panels/6/order', value: 7 },
      ])
    })

    test('"線で分割" then a drag cuts the selected panel along the line', async () => {
      const onChange = vi.fn()
      const svg = await render({
        tool: 'panel',
        onChange,
        selection: { kind: 'panel', id: 'pn_1' },
      })
      layout(svg)
      const button = must(svg.querySelector('[data-cut]'))
      act(() => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(button.getAttribute('aria-pressed')).toBe('true')
      drag(svg, clientAt(0.6, 0.05), clientAt(0.4, 0.2), { release: false })
      expect(svg.querySelector('[data-draft-cut="pn_1"]')).not.toBeNull()
      fire(svg, pointer('pointerup', { id: 1, ...clientAt(0.4, 0.2) }))
      expect(onChange).toHaveBeenCalledTimes(1)
      const [kept, added] = patchOf(onChange) as { value: Panel }[]
      expect(kept?.value.id).toBe('pn_1')
      expect(kept?.value.shape).toHaveLength(4)
      expect(added?.value.shape).toHaveLength(4)
      // 1 回割ったらモードを抜ける
      expect(must(svg.querySelector('[data-cut]')).getAttribute('aria-pressed')).toBe('false')
    })

    test('Alt + drag cuts without the button, and Escape cancels the cut mode', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({
        tool: 'panel',
        onChange,
        onSelect,
        selection: { kind: 'panel', id: 'pn_1' },
      })
      layout(svg)
      fire(svg, pointer('pointerdown', { id: 1, ...clientAt(0.6, 0.05), altKey: true }))
      fire(svg, pointer('pointermove', { id: 1, ...clientAt(0.4, 0.2) }))
      fire(svg, pointer('pointerup', { id: 1, ...clientAt(0.4, 0.2) }))
      expect(onChange).toHaveBeenCalledTimes(1)

      act(() => {
        must(svg.querySelector('[data-cut]')).dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        )
      })
      key(svg, { key: 'Escape' })
      expect(onSelect).not.toHaveBeenCalled()
      expect(must(svg.querySelector('[data-cut]')).getAttribute('aria-pressed')).toBe('false')
    })

    test('Shift while drawing the cut locks a slightly slanted line to vertical', async () => {
      const onChange = vi.fn()
      const svg = await render({
        tool: 'panel',
        onChange,
        selection: { kind: 'panel', id: 'pn_1' },
      })
      layout(svg)
      // 縦から 5 度ほど傾いた線。snapCut では縦にそろわない
      const to = clientAt(0.53, 0.24)
      fire(svg, pointer('pointerdown', { id: 1, ...clientAt(0.5, 0.02), altKey: true }))
      fire(svg, pointer('pointermove', { id: 1, ...to, shiftKey: true }))
      fire(svg, pointer('pointerup', { id: 1, ...to, shiftKey: true }))
      expect(onChange).toHaveBeenCalledTimes(1)
      const [kept, added] = patchOf(onChange) as { value: Panel }[]
      expect(kept?.value.shape).toBeUndefined()
      expect(added?.value.shape).toBeUndefined()
    })

    test('a shaped panel shows vertex handles, and a vertex drag reshapes it', async () => {
      const onChange = vi.fn()
      const shaped: Page = {
        ...samplePage,
        panels: samplePage.panels.map((p) =>
          p.id === 'pn_1'
            ? {
                ...p,
                shape: [
                  { x: 0, y: 0 },
                  { x: 1, y: 0 },
                  { x: 1, y: 1 },
                  { x: 0.2, y: 1 },
                ],
              }
            : p,
        ),
      }
      const svg = await render({
        page: shaped,
        tool: 'panel',
        onChange,
        selection: { kind: 'panel', id: 'pn_1' },
      })
      layout(svg)
      expect(svg.querySelectorAll('[data-vertex]')).toHaveLength(4)
      expect(
        must(svg.querySelector('[data-panel-id="pn_1"] > polygon')).getAttribute('points'),
      ).toBe(polygonPointsOf(shaped.panels[0] as Panel))
      drag(svg, clientAt(0.2, 0.26), clientAt(0.3, 0.26))
      expect(patchOf(onChange)).toEqual([
        {
          op: 'replace',
          path: '/panels/0',
          value: expect.objectContaining({
            id: 'pn_1',
            shape: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0.3, y: 1 },
            ],
          }),
        },
      ])
    })

    test('Alt + corner drag moves one vertex of a rectangle', async () => {
      const onChange = vi.fn()
      const svg = await render({
        tool: 'panel',
        onChange,
        selection: { kind: 'panel', id: 'pn_1' },
      })
      layout(svg)
      fire(svg, pointer('pointerdown', { id: 1, ...clientAt(0, 0.26), altKey: true }))
      fire(svg, pointer('pointermove', { id: 1, ...clientAt(0.2, 0.26) }))
      fire(svg, pointer('pointerup', { id: 1, ...clientAt(0.2, 0.26) }))
      expect(patchOf(onChange)).toEqual([
        {
          op: 'replace',
          path: '/panels/0',
          value: expect.objectContaining({ shape: expect.arrayContaining([{ x: 0.2, y: 1 }]) }),
        },
      ])
    })

    test('Shift + click on another panel merges with one patch', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({
        tool: 'panel',
        onChange,
        onSelect,
        selection: { kind: 'panel', id: 'pn_5' },
      })
      layout(svg)
      const at = clientAt(0.2, 0.95)
      fire(svg, pointer('pointerdown', { id: 1, ...at, shiftKey: true }))
      fire(svg, pointer('pointerup', { id: 1, ...at, shiftKey: true }))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(patchOf(onChange)).toEqual([
        {
          op: 'replace',
          path: '/panels/4',
          value: expect.objectContaining({
            id: 'pn_5',
            order: 5,
            rect: { x: 0, y: 0.835, w: 1, h: 0.165 },
          }),
        },
        { op: 'remove', path: '/panels/5' },
      ])
      expect(onSelect).not.toHaveBeenCalled()
    })

    test('"結合" then a click on another panel merges, and the mode ends', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({
        tool: 'panel',
        onChange,
        onSelect,
        selection: { kind: 'panel', id: 'pn_5' },
      })
      layout(svg)
      const button = must(svg.querySelector('[data-merge]'))
      act(() => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(button.getAttribute('aria-pressed')).toBe('true')
      const at = clientAt(0.2, 0.95)
      fire(svg, pointer('pointerdown', { id: 1, ...at }))
      fire(svg, pointer('pointerup', { id: 1, ...at }))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(patchOf(onChange)).toEqual([
        {
          op: 'replace',
          path: '/panels/4',
          value: expect.objectContaining({ id: 'pn_5', rect: { x: 0, y: 0.835, w: 1, h: 0.165 } }),
        },
        { op: 'remove', path: '/panels/5' },
      ])
      expect(onSelect).not.toHaveBeenCalled()
      expect(must(svg.querySelector('[data-merge]')).getAttribute('aria-pressed')).toBe('false')
    })

    test('"結合" stays on after a refused merge, and Escape cancels it', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({
        tool: 'panel',
        onChange,
        onSelect,
        selection: { kind: 'panel', id: 'pn_2' },
      })
      layout(svg)
      act(() => {
        must(svg.querySelector('[data-merge]')).dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        )
      })
      const at = clientAt(0.2, 0.95)
      fire(svg, pointer('pointerdown', { id: 1, ...at }))
      fire(svg, pointer('pointerup', { id: 1, ...at }))
      expect(onChange).not.toHaveBeenCalled()
      expect(must(svg.querySelector('[data-merge]')).getAttribute('aria-pressed')).toBe('true')
      key(svg, { key: 'Escape' })
      expect(onSelect).not.toHaveBeenCalled()
      expect(must(svg.querySelector('[data-merge]')).getAttribute('aria-pressed')).toBe('false')
    })

    test('a merge that would cover another panel emits nothing', async () => {
      const onChange = vi.fn()
      const svg = await render({
        tool: 'panel',
        onChange,
        selection: { kind: 'panel', id: 'pn_2' },
      })
      layout(svg)
      const at = clientAt(0.2, 0.95)
      fire(svg, pointer('pointerdown', { id: 1, ...at, shiftKey: true }))
      fire(svg, pointer('pointerup', { id: 1, ...at, shiftKey: true }))
      expect(onChange).not.toHaveBeenCalled()
    })

    test('Escape cancels a drag without a patch or a deselect', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({
        tool: 'panel',
        onChange,
        onSelect,
        selection: { kind: 'panel', id: 'pn_2' },
      })
      layout(svg)
      const to = clientAt(0.4, 0.45)
      drag(svg, clientAt(0.1, 0.1), to, { release: false })
      expect(svg.querySelector('[data-draft="new"]')).not.toBeNull()
      key(svg, { key: 'Escape' })
      expect(svg.querySelector('[data-draft]')).toBeNull()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(onChange).not.toHaveBeenCalled()
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('zoom and pan', () => {
    test('starts fitted to the page', async () => {
      const svg = await render()
      expect(viewBox(svg)).toEqual([base.x, base.y, base.w, base.h])
      expect(svg.getAttribute('data-zoom')).toBe('1.000')
    })

    test('wheel zooms around the cursor', async () => {
      const svg = await render()
      layout(svg)
      const e = new WheelEvent('wheel', {
        deltaY: -200,
        clientX: 100,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      })
      fire(svg, e)
      expect(e.defaultPrevented).toBe(true)
      expect(Number(svg.getAttribute('data-zoom'))).toBeGreaterThan(1)
      const [x, y, w] = viewBox(svg) as [number, number, number]
      // カーソル下の点（ページ座標）が動かない
      expect(x + (100 / (base.w * 2)) * w).toBeCloseTo(base.x + 50)
      expect(y + (100 / (base.w * 2)) * w).toBeCloseTo(base.y + 50)
    })

    test('Space drag pans; a plain drag does not', async () => {
      const svg = await render()
      layout(svg)
      fire(svg, pointer('pointerdown', { id: 1, x: 100, y: 100 }))
      fire(svg, pointer('pointermove', { id: 1, x: 140, y: 120 }))
      fire(svg, pointer('pointerup', { id: 1, x: 140, y: 120 }))
      expect(viewBox(svg)).toEqual([base.x, base.y, base.w, base.h])

      fire(svg, pointer('pointerover', { id: 1, x: 100, y: 100 }))
      const space = new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true })
      fire(window, space)
      expect(space.defaultPrevented).toBe(true)
      fire(svg, pointer('pointerdown', { id: 1, x: 100, y: 100 }))
      fire(svg, pointer('pointermove', { id: 1, x: 140, y: 120 }))
      fire(svg, pointer('pointerup', { id: 1, x: 140, y: 120 }))
      fire(window, new KeyboardEvent('keyup', { code: 'Space', key: ' ' }))
      const [x, y, w, h] = viewBox(svg) as [number, number, number, number]
      expect(x).toBeCloseTo(base.x - 20)
      expect(y).toBeCloseTo(base.y - 10)
      expect([w, h]).toEqual([base.w, base.h])
    })

    test('a drag from where nothing is pans, except with the panel tool', async () => {
      const onSelect = vi.fn()
      const svg = await render({ onSelect, selection: { kind: 'panel', id: 'pn_2' } })
      layout(svg)
      // pn_2 と pn_3 の隙間と、作業台。clientAt は全体表示での位置なので隙間を先に引く
      for (const from of [clientAt(0.49, 0.4), { x: 4, y: 4 }]) {
        const [x0, y0] = viewBox(svg) as [number, number]
        drag(svg, from, { x: from.x + 40, y: from.y + 20 })
        const [x, y] = viewBox(svg) as [number, number]
        expect(x).toBeCloseTo(x0 - 20)
        expect(y).toBeCloseTo(y0 - 10)
      }
      expect(onSelect).not.toHaveBeenCalled()

      const onChange = vi.fn()
      const panelTool = await render({ tool: 'panel', onChange })
      layout(panelTool)
      drag(panelTool, clientAt(0.49, 0.4), clientAt(0.6, 0.45))
      expect(viewBox(panelTool)).toEqual([base.x, base.y, base.w, base.h])
    })

    test('right-clicking asks for the menu of what was pressed, which can fit the page back', async () => {
      const onContextMenu = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({
        onContextMenu,
        onSelect,
        selection: { kind: 'panel', id: 'pn_2' },
      })
      layout(svg)
      const menuAt = (at: { x: number; y: number }) => {
        const e = pointer('contextmenu', { id: 1, button: 2, ...at })
        fire(svg, e)
        return e
      }
      // 作業台と、pn_2 と pn_3 の隙間
      expect(menuAt({ x: 4, y: 4 }).defaultPrevented).toBe(true)
      expect(menuAt(clientAt(0.49, 0.4)).defaultPrevented).toBe(true)
      expect(onContextMenu).toHaveBeenLastCalledWith(
        expect.objectContaining({ ...clientAt(0.49, 0.4), target: null }),
      )
      expect(onSelect).not.toHaveBeenCalled()
      // 選んでいるコマはそのまま
      expect(menuAt(clientAt(0.75, 0.4)).defaultPrevented).toBe(true)
      expect(onContextMenu).toHaveBeenLastCalledWith(
        expect.objectContaining({ target: { kind: 'panel', id: 'pn_2' } }),
      )
      expect(onSelect).not.toHaveBeenCalled()
      expect(onContextMenu).toHaveBeenCalledTimes(3)

      drag(svg, { x: 4, y: 4 }, { x: 44, y: 24 })
      expect(viewBox(svg)).not.toEqual([base.x, base.y, base.w, base.h])
      act(() => onContextMenu.mock.calls[0]?.[0].fit())
      expect(viewBox(svg)).toEqual([base.x, base.y, base.w, base.h])
    })

    test('right-clicking an element that is not selected selects it first', async () => {
      const onContextMenu = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ onContextMenu, onSelect })
      layout(svg)
      fire(svg, pointer('contextmenu', { id: 1, button: 2, ...clientAt(0.75, 0.4) }))
      expect(onSelect).toHaveBeenCalledWith({ kind: 'panel', id: 'pn_2' })
      expect(onContextMenu).toHaveBeenCalledWith(
        expect.objectContaining({ target: { kind: 'panel', id: 'pn_2' } }),
      )
    })

    test('without onContextMenu the browser menu stays', async () => {
      const svg = await render()
      layout(svg)
      const e = pointer('contextmenu', { id: 1, button: 2, ...clientAt(0.75, 0.4) })
      fire(svg, e)
      expect(e.defaultPrevented).toBe(false)
    })

    describe('long press', () => {
      const touch = { pointerType: 'touch' }
      afterEach(() => {
        vi.useRealTimers()
      })

      test('holding a finger still asks for the menu of what was pressed', async () => {
        const onContextMenu = vi.fn()
        const onSelect = vi.fn()
        const svg = await render({ onContextMenu, onSelect })
        layout(svg)
        vi.useFakeTimers()
        const at = clientAt(0.75, 0.4)
        fire(svg, pointer('pointerdown', { id: 1, ...at, ...touch }))
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 1))
        expect(onContextMenu).not.toHaveBeenCalled()
        act(() => vi.advanceTimersByTime(1))
        expect(onSelect).toHaveBeenCalledWith({ kind: 'panel', id: 'pn_2' })
        expect(onContextMenu).toHaveBeenCalledWith(
          expect.objectContaining({ ...at, target: { kind: 'panel', id: 'pn_2' } }),
        )
      })

      test('moving the finger after the menu opened neither drags the element nor pans', async () => {
        const onChange = vi.fn()
        const svg = await render({
          onContextMenu: vi.fn(),
          onChange,
          selection: { kind: 'panel', id: 'pn_2' },
        })
        layout(svg)
        vi.useFakeTimers()
        fire(svg, pointer('pointerdown', { id: 1, ...clientAt(0.75, 0.4), ...touch }))
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
        const to = clientAt(0.75, 0.6)
        fire(svg, pointer('pointermove', { id: 1, ...to, ...touch }))
        fire(svg, pointer('pointerup', { id: 1, ...to, ...touch }))
        expect(onChange).not.toHaveBeenCalled()
        expect(viewBox(svg)).toEqual([base.x, base.y, base.w, base.h])
      })

      test('moving, lifting or a second finger before the time cancels it', async () => {
        const onContextMenu = vi.fn()
        const svg = await render({ onContextMenu })
        layout(svg)
        vi.useFakeTimers()
        fire(svg, pointer('pointerdown', { id: 1, x: 4, y: 4, ...touch }))
        fire(svg, pointer('pointermove', { id: 1, x: 24, y: 4, ...touch }))
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
        fire(svg, pointer('pointerup', { id: 1, x: 24, y: 4, ...touch }))
        expect(viewBox(svg)[0]).toBeCloseTo(base.x - 10)

        fire(svg, pointer('pointerdown', { id: 2, x: 4, y: 4, ...touch }))
        fire(svg, pointer('pointerup', { id: 2, x: 4, y: 4, ...touch }))
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS))

        fire(svg, pointer('pointerdown', { id: 3, x: 100, y: 200, ...touch }))
        fire(svg, pointer('pointerdown', { id: 4, x: 200, y: 200, ...touch }))
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
        expect(onContextMenu).not.toHaveBeenCalled()
      })

      test('the contextmenu Android sends on a long press opens the menu once', async () => {
        const onContextMenu = vi.fn()
        const svg = await render({ onContextMenu })
        layout(svg)
        vi.useFakeTimers()
        const at = clientAt(0.75, 0.4)
        fire(svg, pointer('pointerdown', { id: 1, ...at, ...touch }))
        const e = pointer('contextmenu', { id: 1, ...at })
        fire(svg, e)
        expect(e.defaultPrevented).toBe(true)
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
        expect(onContextMenu).toHaveBeenCalledTimes(1)
      })

      test('a mouse held still does not open it', async () => {
        const onContextMenu = vi.fn()
        const svg = await render({ onContextMenu })
        layout(svg)
        vi.useFakeTimers()
        fire(svg, pointer('pointerdown', { id: 1, ...clientAt(0.75, 0.4) }))
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS))
        expect(onContextMenu).not.toHaveBeenCalled()
      })
    })

    test('one finger from where nothing is pans, and a second finger turns it into a pinch', async () => {
      const svg = await render()
      layout(svg)
      const touch = { pointerType: 'touch' }
      fire(svg, pointer('pointerdown', { id: 1, x: 4, y: 4, ...touch }))
      fire(svg, pointer('pointermove', { id: 1, x: 24, y: 4, ...touch }))
      expect(viewBox(svg)[0]).toBeCloseTo(base.x - 10)
      fire(svg, pointer('pointerdown', { id: 2, x: 124, y: 4, ...touch }))
      fire(svg, pointer('pointermove', { id: 2, x: 224, y: 4, ...touch }))
      expect(svg.getAttribute('data-zoom')).toBe('2.000')
    })

    test('Space is left alone while typing in a text field', async () => {
      const svg = await render()
      fire(svg, pointer('pointerover', { id: 1, x: 100, y: 100 }))
      const input = document.createElement('input')
      document.body.append(input)
      const space = new KeyboardEvent('keydown', {
        code: 'Space',
        key: ' ',
        bubbles: true,
        cancelable: true,
      })
      fire(input, space)
      expect(space.defaultPrevented).toBe(false)
    })

    test('two-finger pinch zooms and pans', async () => {
      const svg = await render()
      layout(svg)
      const touch = { pointerType: 'touch' }
      fire(svg, pointer('pointerdown', { id: 1, x: 100, y: 200, ...touch }))
      fire(svg, pointer('pointerdown', { id: 2, x: 200, y: 200, ...touch }))
      fire(svg, pointer('pointermove', { id: 2, x: 300, y: 200, ...touch }))
      expect(svg.getAttribute('data-zoom')).toBe('2.000')
      fire(svg, pointer('pointerup', { id: 2, x: 300, y: 200, ...touch }))
      fire(svg, pointer('pointermove', { id: 1, x: 0, y: 0, ...touch }))
      expect(svg.getAttribute('data-zoom')).toBe('2.000')
    })
  })

  describe('ghostPage', () => {
    const ghostPage: Page = {
      ...samplePage,
      panels: samplePage.panels.map((panel, i) => {
        if (i === 3) {
          return {
            ...panel,
            focusPoints: panel.focusPoints.map((f, j) =>
              j === 1 ? { ...f, pos: { x: 0.82, y: 0.72 } } : f,
            ),
          }
        }
        if (i === 4) {
          return {
            ...panel,
            vectors: [
              ...panel.vectors,
              {
                id: 'vc_ghost',
                kind: 'speed',
                from: { x: 0.9, y: 0.35 },
                to: { x: 0.68, y: 0.47 },
                strength: 'weak',
              },
            ],
          }
        }
        if (i === 5) {
          return {
            ...panel,
            bubbles: panel.bubbles.map((b) => ({ ...b, pos: { x: 0.8, y: 0.3 } })),
          }
        }
        return panel
      }),
    }

    test('draws nothing without ghostPage', async () => {
      const svg = await render()
      expect(svg.querySelector('[data-layer="ghost"]')).toBeNull()
    })

    test('draws the moved focus and bubble at both positions and the added vector', async () => {
      const svg = await render({ ghostPage })
      const layer = must(svg.querySelector('[data-layer="ghost"]'))
      const focus = must(layer.querySelector('[data-ghost-focus-id="fp_4_e"]'))
      expect(focus.querySelector('[data-ghost="before"]')).not.toBeNull()
      expect(focus.querySelector('[data-ghost="after"]')).not.toBeNull()
      const bubble = must(layer.querySelector('[data-ghost-bubble-id="bb_6"]'))
      expect(bubble.querySelectorAll('path[data-ghost]')).toHaveLength(2)
      expect(layer.querySelector('[data-ghost-vector-id="vc_ghost"]')).not.toBeNull()
      expect(layer.querySelectorAll('[data-ghost-focus-id]')).toHaveLength(1)
      expect(layer.querySelectorAll('[data-ghost-bubble-id]')).toHaveLength(1)
    })

    test('draws nothing for an unchanged page', async () => {
      const svg = await render({ ghostPage: samplePage })
      expect(svg.querySelector('[data-ghost]')).toBeNull()
    })
  })

  /** コマ panelId のコマ内座標に対応する、layout 後の画面座標 */
  const inPanel = (panelId: string, x: number, y: number) => {
    const { rect } = must(samplePage.panels.find((p) => p.id === panelId))
    return clientAt(rect.x + x * rect.w, rect.y + y * rect.h)
  }

  describe('hints layer', () => {
    test('draws every focus and vector with its kind, strength and label', async () => {
      const svg = await render()
      const layer = must(svg.querySelector('[data-layer="hints"]'))
      expect(layer.querySelectorAll('[data-focus-id]')).toHaveLength(9)
      expect(layer.querySelectorAll('[data-vector-id]')).toHaveLength(13)
      const focus = must(layer.querySelector('[data-focus-id="fp_4_mask"]'))
      expect(focus.getAttribute('data-kind')).toBe('face')
      // weight 0.7 の焦点は半径 7mm
      expect(must(focus.querySelector('circle')).getAttribute('r')).toBe('7')
      expect(focus.textContent).toBe('beast porcelain mask')
      const strong = must(layer.querySelector('[data-vector-id="vc_4_a"]'))
      const weak = must(layer.querySelector('[data-vector-id="vc_4_b"]'))
      expect(strong.getAttribute('data-strength')).toBe('strong')
      expect(must(strong.querySelector('line')).getAttribute('stroke-width')).toBe('2')
      expect(must(weak.querySelector('line')).getAttribute('stroke-width')).toBe('1')
    })

    test('marks the selected focus and vector in the guide colour', async () => {
      const focusSelected = await render({ selection: { kind: 'focus', id: 'fp_2_e' } })
      const focus = must(focusSelected.querySelector('[data-focus-id="fp_2_e"]'))
      expect(focus.hasAttribute('data-selected')).toBe(true)
      expect(must(focus.querySelector('circle')).style.stroke).toBe('var(--guide)')
      expect(focusSelected.querySelectorAll('[data-layer="hints"] [data-selected]')).toHaveLength(1)

      const vectorSelected = await render({ selection: { kind: 'vector', id: 'vc_2_a' } })
      const vector = must(vectorSelected.querySelector('[data-vector-id="vc_2_a"]'))
      expect(vector.hasAttribute('data-selected')).toBe(true)
      expect(vector.querySelectorAll('line')).toHaveLength(2)
    })

    test('layers.hints = false draws no hints', async () => {
      const svg = await render({ layers: { ...defaults.layers, hints: false } })
      expect(svg.querySelector('[data-layer="hints"]')).toBeNull()
    })

    test('layers.frames draws the bleed 3mm outside the trim and a centred inner frame', async () => {
      const svg = await render({
        settings: { ...project.settings, pageSize: { w: 182, h: 257, unit: 'mm' } },
      })
      const frame = (name: string) => {
        const r = must(svg.querySelector(`[data-layer="frames"] [data-frame="${name}"]`))
        return ['x', 'y', 'width', 'height'].map((a) => Number(r.getAttribute(a)))
      }
      expect(frame('bleed')).toEqual([-3, -3, 188, 263])
      expect(frame('trim')).toEqual([0, 0, 182, 257])
      expect(frame('inner').map((v) => Math.round(v * 10) / 10)).toEqual([16, 18.5, 150, 220])

      const hidden = await render({ layers: { ...defaults.layers, frames: false } })
      expect(hidden.querySelector('[data-layer="frames"]')).toBeNull()
    })
  })

  describe('hint tool', () => {
    test('a focus click on an empty spot places a focus of focusKind and selects it', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'focus', focusKind: 'sfx', onChange, onSelect })
      layout(svg)
      click(svg, inPanel('pn_5', 0.2, 0.3))
      expect(onChange).toHaveBeenCalledTimes(1)
      const patch = patchOf(onChange)
      expect(patch).toEqual([
        {
          op: 'add',
          path: '/panels/4/focusPoints/-',
          value: expect.objectContaining({ kind: 'sfx', label: '', pos: { x: 0.2, y: 0.3 } }),
        },
      ])
      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith({
        kind: 'focus',
        id: (patch[0] as { value: { id: string } }).value.id,
      })
    })

    test('focusKind defaults to face', async () => {
      const onChange = vi.fn()
      const svg = await render({ tool: 'focus', onChange })
      layout(svg)
      click(svg, inPanel('pn_5', 0.2, 0.3))
      expect(patchOf(onChange)).toEqual([
        expect.objectContaining({ value: expect.objectContaining({ kind: 'face' }) }),
      ])
    })

    test('a drag from an empty spot draws a draft, then places a focus as large as the drag', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'focus', focusKind: 'sfx', onChange, onSelect })
      layout(svg)
      const from = inPanel('pn_5', 0.2, 0.3)
      // 画面は 1mm を 2px で描くので、半径 6mm
      const to = { x: from.x + 12, y: from.y }
      drag(svg, from, to, { release: false })
      expect(svg.querySelector('[data-hints-panel-id="pn_5"] [data-draft="focus"]')).not.toBeNull()
      expect(onChange).not.toHaveBeenCalled()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(svg.querySelector('[data-draft="focus"]')).toBeNull()
      const patch = patchOf(onChange)
      expect(patch).toEqual([
        expect.objectContaining({
          value: expect.objectContaining({ kind: 'sfx', pos: { x: 0.2, y: 0.3 } }),
        }),
      ])
      const { weight } = (patch[0] as { value: { weight: number } }).value
      expect(focusRadius(weight)).toBeCloseTo(6, 0)
      expect(onSelect).toHaveBeenCalledWith({
        kind: 'focus',
        id: (patch[0] as { value: { id: string } }).value.id,
      })
    })

    test('dragging a focus selects it, draws it moved, and moves its linked vectors in one patch', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'focus', onChange, onSelect })
      layout(svg)
      const centre = () =>
        Number(must(svg.querySelector('[data-focus-id="fp_2_e"] circle')).getAttribute('cx'))
      const before = centre()
      const to = inPanel('pn_2', 0.8, 0.3)
      drag(svg, inPanel('pn_2', 0.75, 0.3), to, { release: false })
      expect(onSelect).toHaveBeenCalledWith({ kind: 'focus', id: 'fp_2_e' })
      expect(onChange).not.toHaveBeenCalled()
      // 0.05 x 91mm
      expect(centre() - before).toBeCloseTo(4.55)
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(patchOf(onChange)).toEqual([
        { op: 'replace', path: '/panels/1/focusPoints/0/pos', value: { x: 0.8, y: 0.3 } },
        { op: 'replace', path: '/panels/1/vectors/0/from', value: { x: 0.77, y: 0.33 } },
        { op: 'replace', path: '/panels/1/vectors/1/to', value: { x: 0.83, y: 0.28 } },
        { op: 'replace', path: '/panels/1/vectors/2/to', value: { x: 0.83, y: 0.33 } },
      ])
      expect(centre()).toBeCloseTo(before)
    })

    test('the linked vector ends follow the dragged focus while dragging', async () => {
      const svg = await render({ tool: 'focus' })
      layout(svg)
      const endX = () =>
        Number(
          must(svg.querySelector('[data-vector-id="vc_2_b"] polygon'))
            .getAttribute('points')
            ?.split(',')[0],
        )
      const unlinkedX = () =>
        Number(
          must(svg.querySelector('[data-vector-id="vc_2_d"] polygon'))
            .getAttribute('points')
            ?.split(',')[0],
        )
      const [end, unlinked] = [endX(), unlinkedX()]
      drag(svg, inPanel('pn_2', 0.75, 0.3), inPanel('pn_2', 0.8, 0.3), { release: false })
      expect(endX() - end).toBeCloseTo(4.55)
      expect(unlinkedX()).toBe(unlinked)
    })

    test('Escape cancels a focus drag without a patch or a deselect', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({
        tool: 'focus',
        onChange,
        onSelect,
        selection: { kind: 'focus', id: 'fp_2_e' },
      })
      layout(svg)
      const to = inPanel('pn_2', 0.8, 0.3)
      drag(svg, inPanel('pn_2', 0.75, 0.3), to, { release: false })
      const e = key(svg, { key: 'Escape' })
      expect(e.defaultPrevented).toBe(true)
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(onChange).not.toHaveBeenCalled()
      expect(onSelect).not.toHaveBeenCalled()
    })

    test('a vector drag draws a dashed draft, then creates one linked vector and selects it', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'vector', onChange, onSelect })
      layout(svg)
      const to = inPanel('pn_2', 0.45, 0.5)
      drag(svg, inPanel('pn_2', 0.75, 0.3), to, { release: false })
      expect(svg.querySelector('[data-hints-panel-id="pn_2"] [data-draft="vector"]')).not.toBeNull()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(svg.querySelector('[data-draft="vector"]')).toBeNull()
      expect(onChange).toHaveBeenCalledTimes(1)
      const patch = patchOf(onChange)
      expect(patch).toEqual([
        {
          op: 'add',
          path: '/panels/1/vectors/-',
          value: expect.objectContaining({
            kind: 'gaze',
            from: { x: 0.75, y: 0.3 },
            to: { x: 0.45, y: 0.5 },
            sourceFocusId: 'fp_2_e',
            targetFocusId: 'fp_2_vial',
          }),
        },
      ])
      expect(onSelect).toHaveBeenLastCalledWith({
        kind: 'vector',
        id: (patch[0] as { value: { id: string } }).value.id,
      })
    })

    test('a vector click selects what is under it instead of creating', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'vector', onChange, onSelect })
      layout(svg)
      click(svg, inPanel('pn_2', 0.75, 0.3))
      expect(onChange).not.toHaveBeenCalled()
      expect(onSelect).toHaveBeenCalledWith({ kind: 'focus', id: 'fp_2_e' })
    })

    test('Escape cancels a vector drag', async () => {
      const onChange = vi.fn()
      const svg = await render({ tool: 'vector', onChange })
      layout(svg)
      const to = inPanel('pn_2', 0.45, 0.5)
      drag(svg, inPanel('pn_2', 0.75, 0.3), to, { release: false })
      key(svg, { key: 'Escape' })
      expect(svg.querySelector('[data-draft="vector"]')).toBeNull()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(onChange).not.toHaveBeenCalled()
    })

    test('with layers.hints = false neither tool places or grabs anything', async () => {
      const onChange = vi.fn()
      const layers = { ...defaults.layers, hints: false }
      const focus = await render({ tool: 'focus', layers, onChange })
      layout(focus)
      click(focus, inPanel('pn_5', 0.2, 0.3))
      drag(focus, inPanel('pn_2', 0.75, 0.3), inPanel('pn_2', 0.8, 0.3))
      const vector = await render({ tool: 'vector', layers, onChange })
      layout(vector)
      drag(vector, inPanel('pn_2', 0.75, 0.3), inPanel('pn_2', 0.45, 0.5))
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('bubble tool', () => {
    test('a click on an empty spot of a panel creates a default bubble there and selects it', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'bubble', onChange, onSelect })
      layout(svg)
      click(svg, inPanel('pn_5', 0.4, 0.5))
      expect(onChange).toHaveBeenCalledTimes(1)
      const patch = patchOf(onChange)
      expect(patch).toEqual([
        {
          op: 'add',
          path: '/panels/4/bubbles/0',
          value: expect.objectContaining({ order: 1, shape: 'normal', pos: { x: 0.4, y: 0.5 } }),
        },
      ])
      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith({
        kind: 'bubble',
        id: (patch[0] as { value: { id: string } }).value.id,
      })
    })

    test('a click outside the page creates nothing', async () => {
      const onChange = vi.fn()
      const svg = await render({ tool: 'bubble', onChange })
      layout(svg)
      click(svg, { x: -10, y: -10 })
      expect(onChange).not.toHaveBeenCalled()
    })

    test('a drag from an empty spot draws a draft, then creates a bubble spanning the drag', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'bubble', onChange, onSelect })
      layout(svg)
      const to = inPanel('pn_5', 0.2, 0.4)
      drag(svg, inPanel('pn_5', 0.6, 0.6), to, { release: false })
      expect(svg.querySelector('[data-layer="bubble-tool"][data-draft]')).not.toBeNull()
      expect(onChange).not.toHaveBeenCalled()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(svg.querySelector('[data-layer="bubble-tool"][data-draft]')).toBeNull()
      const patch = patchOf(onChange)
      expect(patch).toEqual([
        {
          op: 'add',
          path: '/panels/4/bubbles/0',
          value: expect.objectContaining({ pos: { x: 0.4, y: 0.5 }, size: { w: 0.4, h: 0.2 } }),
        },
      ])
      expect(onSelect).toHaveBeenCalledWith({
        kind: 'bubble',
        id: (patch[0] as { value: { id: string } }).value.id,
      })
    })

    test('dragging a bubble draws a draft, then moves it with its tail and selects it', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'bubble', onChange, onSelect })
      layout(svg)
      const to = inPanel('pn_3', 0.75, 0.25)
      drag(svg, inPanel('pn_3', 0.85, 0.25), to, { release: false })
      expect(svg.querySelector('[data-layer="bubble-tool"][data-draft="bb_3"]')).not.toBeNull()
      expect(onChange).not.toHaveBeenCalled()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(svg.querySelector('[data-layer="bubble-tool"][data-draft]')).toBeNull()
      expect(patchOf(onChange)).toEqual([
        { op: 'replace', path: '/panels/2/bubbles/0/pos', value: { x: 0.75, y: 0.25 } },
        { op: 'replace', path: '/panels/2/bubbles/0/tail', value: { x: 0.54, y: 0.38 } },
      ])
      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith({ kind: 'bubble', id: 'bb_3' })
    })

    test('a click on a bubble only selects it', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'bubble', onChange, onSelect })
      layout(svg)
      click(svg, inPanel('pn_3', 0.85, 0.25))
      expect(onChange).not.toHaveBeenCalled()
      expect(onSelect).toHaveBeenCalledWith({ kind: 'bubble', id: 'bb_3' })
    })

    test('a locked bubble is not moved, has no handles, and a click on it only selects it', async () => {
      const page = {
        ...samplePage,
        panels: samplePage.panels.map((panel) => ({
          ...panel,
          bubbles: panel.bubbles.map((b) => (b.id === 'bb_3' ? { ...b, locked: true } : b)),
        })),
      }
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({
        tool: 'bubble',
        page,
        selection: { kind: 'bubble', id: 'bb_3' },
        onChange,
        onSelect,
      })
      layout(svg)
      expect(svg.querySelector('[data-layer="bubble-tool"]')).toBeNull()
      drag(svg, inPanel('pn_3', 0.85, 0.25), inPanel('pn_3', 0.75, 0.25))
      click(svg, inPanel('pn_3', 0.85, 0.25))
      expect(onChange).not.toHaveBeenCalled()
    })

    test('the selected bubble shows four corner handles and its tail handle', async () => {
      const svg = await render({ tool: 'bubble', selection: { kind: 'bubble', id: 'bb_3' } })
      const layer = must(svg.querySelector('[data-layer="bubble-tool"]'))
      expect(
        [...layer.querySelectorAll('[data-handle]')].map((h) => h.getAttribute('data-handle')),
      ).toEqual(['nw', 'ne', 'se', 'sw'])
      expect(must(layer.querySelector('[data-tail-handle]')).getAttribute('data-tail-handle')).toBe(
        'set',
      )
      const select = await render({ tool: 'select', selection: { kind: 'bubble', id: 'bb_3' } })
      expect(select.querySelector('[data-layer="bubble-tool"]')).toBeNull()
    })

    test('a corner drag resizes the bubble around the opposite corner', async () => {
      const onChange = vi.fn()
      const svg = await render({
        tool: 'bubble',
        onChange,
        selection: { kind: 'bubble', id: 'bb_3' },
      })
      layout(svg)
      const to = inPanel('pn_3', 0.96, 0.55)
      drag(svg, inPanel('pn_3', 0.96, 0.45), to, { release: false })
      expect(svg.querySelector('[data-layer="bubble-tool"][data-draft="bb_3"]')).not.toBeNull()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(patchOf(onChange)).toEqual([
        { op: 'replace', path: '/panels/2/bubbles/0/pos', value: { x: 0.85, y: 0.3 } },
        { op: 'replace', path: '/panels/2/bubbles/0/size', value: { w: 0.22, h: 0.5 } },
      ])
    })

    // bb_1 はナレーションでしっぽが付かないので、普通のフキダシにして試す
    const asNormal = (id: string): Page => ({
      ...samplePage,
      panels: samplePage.panels.map((p) => ({
        ...p,
        bubbles: p.bubbles.map((b) => (b.id === id ? { ...b, shape: 'normal' as const } : b)),
      })),
    })

    test('a narration bubble has no tail handle', async () => {
      const svg = await render({ tool: 'bubble', selection: { kind: 'bubble', id: 'bb_1' } })
      expect(svg.querySelector('[data-layer="bubble-tool"]')).not.toBeNull()
      expect(svg.querySelector('[data-tail-handle]')).toBeNull()
    })

    test('dragging the unset tail handle adds a tail', async () => {
      const onChange = vi.fn()
      const svg = await render({
        page: asNormal('bb_1'),
        tool: 'bubble',
        onChange,
        selection: { kind: 'bubble', id: 'bb_1' },
      })
      layout(svg)
      expect(must(svg.querySelector('[data-tail-handle]')).getAttribute('data-tail-handle')).toBe(
        'unset',
      )
      // 未設定の先端は本体の下、中心から縦の半径の 1.5 倍
      const handle = inPanel('pn_1', 0.92, 0.22 + 0.275 * 1.5)
      drag(svg, handle, inPanel('pn_1', 0.7, 0.9))
      expect(patchOf(onChange)).toEqual([
        { op: 'add', path: '/panels/0/bubbles/0/tail', value: { x: 0.7, y: 0.9 } },
      ])
    })

    test('Escape cancels a bubble drag without a patch or a deselect', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({
        tool: 'bubble',
        onChange,
        onSelect,
        selection: { kind: 'bubble', id: 'bb_3' },
      })
      layout(svg)
      const to = inPanel('pn_3', 0.95, 0.25)
      drag(svg, inPanel('pn_3', 0.85, 0.25), to, { release: false })
      key(svg, { key: 'Escape' })
      expect(svg.querySelector('[data-layer="bubble-tool"][data-draft]')).toBeNull()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(onChange).not.toHaveBeenCalled()
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('moving with the select tool', () => {
    test('dragging the selected panel draws a draft, then moves it inside the page', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ onChange, onSelect, selection: { kind: 'panel', id: 'pn_2' } })
      layout(svg)
      const to = clientAt(0.65, 0.4)
      drag(svg, clientAt(0.75, 0.4), to, { release: false })
      expect(svg.querySelector('[data-draft="pn_2"]')).not.toBeNull()
      expect(onChange).not.toHaveBeenCalled()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(svg.querySelector('[data-draft]')).toBeNull()
      expect(patchOf(onChange)).toEqual([{ op: 'replace', path: '/panels/1/rect/x', value: 0.4 }])
      expect(onSelect).not.toHaveBeenCalled()

      // pn_2 は右端にあるので、右へは動かない
      onChange.mockClear()
      drag(svg, clientAt(0.75, 0.4), clientAt(0.9, 0.4))
      expect(onChange).not.toHaveBeenCalled()
    })

    test('dragging the selected bubble moves it with its tail', async () => {
      const onChange = vi.fn()
      const svg = await render({ onChange, selection: { kind: 'bubble', id: 'bb_3' } })
      layout(svg)
      const to = inPanel('pn_3', 0.75, 0.25)
      drag(svg, inPanel('pn_3', 0.85, 0.25), to, { release: false })
      expect(svg.querySelector('[data-layer="bubble-tool"][data-draft="bb_3"]')).not.toBeNull()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(patchOf(onChange)).toEqual([
        { op: 'replace', path: '/panels/2/bubbles/0/pos', value: { x: 0.75, y: 0.25 } },
        { op: 'replace', path: '/panels/2/bubbles/0/tail', value: { x: 0.54, y: 0.38 } },
      ])
    })

    test('a locked panel or bubble does not move', async () => {
      const page = {
        ...samplePage,
        panels: samplePage.panels.map((panel) => ({
          ...panel,
          locked: panel.id === 'pn_2' || undefined,
          bubbles: panel.bubbles.map((b) => (b.id === 'bb_3' ? { ...b, locked: true } : b)),
        })),
      }
      const onChange = vi.fn()
      const panel = await render({ page, onChange, selection: { kind: 'panel', id: 'pn_2' } })
      layout(panel)
      drag(panel, clientAt(0.75, 0.4), clientAt(0.65, 0.4), { release: false })
      expect(panel.querySelector('[data-draft]')).toBeNull()
      fire(panel, pointer('pointerup', { id: 1, ...clientAt(0.65, 0.4) }))
      const bubble = await render({ page, onChange, selection: { kind: 'bubble', id: 'bb_3' } })
      layout(bubble)
      drag(bubble, inPanel('pn_3', 0.85, 0.25), inPanel('pn_3', 0.75, 0.25))
      expect(onChange).not.toHaveBeenCalled()
    })

    test('an element that is not selected does not move', async () => {
      const onChange = vi.fn()
      const svg = await render({ onChange, selection: { kind: 'panel', id: 'pn_1' } })
      layout(svg)
      drag(svg, clientAt(0.75, 0.4), clientAt(0.65, 0.4))
      drag(svg, inPanel('pn_3', 0.85, 0.25), inPanel('pn_3', 0.75, 0.25))
      expect(onChange).not.toHaveBeenCalled()
    })

    test('Escape cancels a move without a patch or a deselect', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ onChange, onSelect, selection: { kind: 'panel', id: 'pn_2' } })
      layout(svg)
      const to = clientAt(0.65, 0.4)
      drag(svg, clientAt(0.75, 0.4), to, { release: false })
      key(svg, { key: 'Escape' })
      expect(svg.querySelector('[data-draft]')).toBeNull()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(onChange).not.toHaveBeenCalled()
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('scribble', () => {
    const stroke = (id: string, points: { x: number; y: number }[]) => ({
      id,
      points,
      width: 0.002,
      color: 'ink' as const,
    })
    const withScribbles: Page = {
      ...samplePage,
      scribbles: [
        stroke('st_1', [
          { x: 0.1, y: 0.5 },
          { x: 0.9, y: 0.5 },
        ]),
        stroke('st_2', [
          { x: 0.5, y: 0.4 },
          { x: 0.5, y: 0.6 },
        ]),
        stroke('st_dot', [{ x: 0.2, y: 0.2 }]),
      ],
    }

    test('a drag draws a live line, then adds one stroke in the chosen colour', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({ tool: 'scribble', scribbleTool: 'red', onChange, onSelect })
      layout(svg)
      const to = clientAt(0.3, 0.2)
      drag(svg, clientAt(0.2, 0.2), to, { release: false })
      const live = must(svg.querySelector('[data-live-stroke]'))
      expect(live.getAttribute('points')?.split(' ')).toHaveLength(3)
      expect(onChange).not.toHaveBeenCalled()
      fire(svg, pointer('pointerup', { id: 1, ...to }))
      expect(live.getAttribute('points')).toBe('')
      const patch = patchOf(onChange)
      expect(patch).toEqual([
        {
          op: 'add',
          path: '/scribbles/-',
          value: expect.objectContaining({ color: 'red', width: 0.002 }),
        },
      ])
      const { points } = (patch[0] as { value: { points: { x: number; y: number }[] } }).value
      expect(points.map((p) => [p.x, p.y])).toEqual([
        [expect.closeTo(0.2), expect.closeTo(0.2)],
        [expect.closeTo(0.25), expect.closeTo(0.2)],
        [expect.closeTo(0.3), expect.closeTo(0.2)],
      ])
      expect(onSelect).not.toHaveBeenCalled()
    })

    test('points closer than the minimum step are dropped, and points stay on the page', async () => {
      const onChange = vi.fn()
      const svg = await render({ tool: 'scribble', onChange })
      layout(svg)
      const from = clientAt(0.5, 0.5)
      fire(svg, pointer('pointerdown', { id: 1, ...from }))
      fire(svg, pointer('pointermove', { id: 1, x: from.x + 0.2, y: from.y }))
      fire(svg, pointer('pointermove', { id: 1, x: -100, y: -100 }))
      fire(svg, pointer('pointerup', { id: 1, x: -100, y: -100 }))
      const { points, color } = (
        patchOf(onChange)[0] as { value: { points: unknown; color: string } }
      ).value
      expect(color).toBe('ink')
      expect(points).toEqual([
        { x: expect.closeTo(0.5), y: expect.closeTo(0.5) },
        { x: 0, y: 0 },
      ])
    })

    test('strokes are drawn as polylines, and a one-point stroke as a dot', async () => {
      const svg = await render({ page: withScribbles })
      expect(svg.querySelectorAll('[data-layer="scribble"] [data-stroke-id]')).toHaveLength(3)
      const x = 0.2 * 182
      const y = 0.2 * 257
      expect(must(svg.querySelector('[data-stroke-id="st_dot"]')).getAttribute('points')).toBe(
        `${x},${y} ${x},${y}`,
      )
      expect(svg.querySelector('[data-live-stroke]')).toBeNull()
    })

    test('the eraser removes the topmost stroke under the pointer, and nothing elsewhere', async () => {
      const onChange = vi.fn()
      const svg = await render({
        page: withScribbles,
        tool: 'scribble',
        scribbleTool: 'eraser',
        onChange,
      })
      layout(svg)
      click(svg, clientAt(0.5, 0.5))
      expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/scribbles/1' }])
      // 線の 6px 以内なら拾う
      click(svg, { x: clientAt(0.3, 0.5).x, y: clientAt(0.3, 0.5).y + 5 })
      expect(onChange).toHaveBeenLastCalledWith([{ op: 'remove', path: '/scribbles/0' }])
      click(svg, clientAt(0.3, 0.8))
      expect(onChange).toHaveBeenCalledTimes(2)
    })

    test('a touch eraser waits for pointerup, and a second finger cancels it', async () => {
      const onChange = vi.fn()
      const svg = await render({
        page: withScribbles,
        tool: 'scribble',
        scribbleTool: 'eraser',
        onChange,
      })
      layout(svg)
      const at = clientAt(0.5, 0.5)
      const touch = { pointerType: 'touch' }
      fire(svg, pointer('pointerdown', { id: 1, ...at, ...touch }))
      expect(onChange).not.toHaveBeenCalled()
      fire(svg, pointer('pointerup', { id: 1, ...at, ...touch }))
      expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/scribbles/1' }])

      fire(svg, pointer('pointerdown', { id: 2, ...at, ...touch }))
      fire(svg, pointer('pointerdown', { id: 3, x: at.x + 100, y: at.y, ...touch }))
      fire(svg, pointer('pointerup', { id: 2, ...at, ...touch }))
      fire(svg, pointer('pointerup', { id: 3, x: at.x + 100, y: at.y, ...touch }))
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    test('a second finger throws away the line being drawn', async () => {
      const onChange = vi.fn()
      const svg = await render({ tool: 'scribble', onChange })
      layout(svg)
      const touch = { pointerType: 'touch' }
      const from = clientAt(0.2, 0.2)
      fire(svg, pointer('pointerdown', { id: 1, ...from, ...touch }))
      fire(svg, pointer('pointermove', { id: 1, x: from.x + 40, y: from.y, ...touch }))
      fire(svg, pointer('pointerdown', { id: 2, x: from.x + 200, y: from.y, ...touch }))
      expect(must(svg.querySelector('[data-live-stroke]')).getAttribute('points')).toBe('')
      fire(svg, pointer('pointerup', { id: 1, x: from.x + 40, y: from.y, ...touch }))
      fire(svg, pointer('pointerup', { id: 2, x: from.x + 200, y: from.y, ...touch }))
      expect(onChange).not.toHaveBeenCalled()
    })

    test('with the scribble layer hidden the tool neither draws nor selects', async () => {
      const onChange = vi.fn()
      const onSelect = vi.fn()
      const svg = await render({
        tool: 'scribble',
        layers: { ...defaults.layers, scribble: false },
        onChange,
        onSelect,
      })
      layout(svg)
      expect(svg.querySelector('[data-layer="scribble"]')).toBeNull()
      drag(svg, clientAt(0.2, 0.2), clientAt(0.3, 0.2))
      click(svg, clientAt(0.75, 0.4))
      expect(onChange).not.toHaveBeenCalled()
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('sketch', () => {
    const line = (id: string) => ({
      id,
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
      width: 0.002,
      color: 'ink' as const,
    })

    test('the first stroke creates Page.sketch, later strokes are appended to it', async () => {
      const onChange = vi.fn()
      const svg = await render({ tool: 'sketch', onChange })
      layout(svg)
      drag(svg, clientAt(0.2, 0.2), clientAt(0.3, 0.2))
      expect(patchOf(onChange)).toEqual([
        { op: 'add', path: '/sketch', value: [expect.objectContaining({ color: 'ink' })] },
      ])

      const appended = vi.fn()
      const again = await render({
        page: { ...samplePage, sketch: [line('sk_1')] },
        tool: 'sketch',
        onChange: appended,
      })
      layout(again)
      drag(again, clientAt(0.2, 0.2), clientAt(0.3, 0.2))
      expect(patchOf(appended)).toEqual([
        { op: 'add', path: '/sketch/-', value: expect.objectContaining({ color: 'ink' }) },
      ])
    })

    test('sketch strokes are drawn in their own layer and erased from Page.sketch', async () => {
      const onChange = vi.fn()
      const svg = await render({
        page: { ...samplePage, sketch: [line('sk_1')] },
        tool: 'sketch',
        sketchTool: 'eraser',
        onChange,
      })
      layout(svg)
      expect(svg.querySelectorAll('[data-layer="sketch"] [data-stroke-id]')).toHaveLength(1)
      expect(svg.querySelectorAll('[data-layer="scribble"] [data-stroke-id]')).toHaveLength(0)
      click(svg, clientAt(0.5, 0.5))
      expect(onChange).toHaveBeenCalledWith([{ op: 'remove', path: '/sketch/0' }])
    })

    test('with the sketch layer hidden the tool does nothing', async () => {
      const onChange = vi.fn()
      const svg = await render({
        tool: 'sketch',
        layers: { ...defaults.layers, sketch: false },
        onChange,
      })
      layout(svg)
      expect(svg.querySelector('[data-layer="sketch"]')).toBeNull()
      drag(svg, clientAt(0.2, 0.2), clientAt(0.3, 0.2))
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  /** 1 フレームの予算（60fps） */
  const FRAME_MS = 16
  const ROWS = 6
  const COLUMNS = 5
  const BUBBLES = 20
  const MOVES = 120
  const SHAPES = BubbleSchema.shape.shape.options

  /** 6 行 5 列の 30 コマ。先頭の 20 コマにフキダシを 1 つずつ置き、全コマに画像を採用する */
  function bigPage(): Page {
    const panels: Panel[] = []
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLUMNS; col++) {
        const i = panels.length
        const id = `pn_${i + 1}`
        const bubbles: Bubble[] =
          i < BUBBLES
            ? [
                {
                  id: `bb_${i + 1}`,
                  order: 1,
                  text: 'セリフがここに入る。少し長めのセリフ',
                  shape: SHAPES[i % SHAPES.length] ?? 'normal',
                  pos: { x: 0.5, y: 0.5 },
                  size: { w: 0.5, h: 0.6 },
                  tail: { x: 0.2, y: 0.95 },
                },
              ]
            : []
        panels.push({
          id,
          order: i + 1,
          rect: {
            x: col / COLUMNS + 0.005,
            y: row / ROWS + 0.005,
            w: 1 / COLUMNS - 0.01,
            h: 1 / ROWS - 0.01,
          },
          bubbles,
          arts: [
            {
              id: `art_${id}`,
              ref: `file:art/${id}.png`,
              provider: 'fake',
              prompt: 'p',
              createdAt: '2026-10-16T00:00:00.000Z',
            },
          ],
          artId: `art_${id}`,
          camera: 'long',
          focusPoints: [],
          vectors: [],
        })
      }
    }
    return { id: 'pg_perf', panels, scribbles: [] }
  }

  /** act 込みで 1 イベントを処理しきるまでの ms */
  function timed(target: EventTarget, e: Event): number {
    const start = performance.now()
    act(() => {
      target.dispatchEvent(e)
    })
    return performance.now() - start
  }

  /**
   * 所要時間が 1 フレームに収まることを確かめる。PERF=1（mise run perf）のときだけ測る。
   * 共有ランナーの CPU で所要時間がぶれ、コードと無関係に落ちるため。描き直す要素の数は常に確かめる
   */
  function expectWithinFrame(ms: number): void {
    if (process.env.PERF) expect(ms).toBeLessThan(FRAME_MS)
  }

  const percentile = (xs: number[], p: number) => {
    const sorted = [...xs].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  }

  test(`dragging a bubble on ${ROWS * COLUMNS} panels and ${BUBBLES} bubbles stays within ${FRAME_MS}ms per frame`, async () => {
    const page = bigPage()
    const panel = page.panels[7] as Panel
    // pointerup の Patch を親が適用した結果。中身は Patch の検証ではないので、移動後のページを直接作る
    const next: Page = {
      ...page,
      panels: page.panels.map((p) =>
        p.id === panel.id
          ? { ...p, bubbles: p.bubbles.map((b) => ({ ...b, pos: { x: 0.8, y: 0.5 } })) }
          : p,
      ),
    }
    let changed = 0
    const props: EditorCanvasProps = {
      ...defaults,
      page,
      selection: { kind: 'bubble', id: 'bb_8' },
      tool: 'bubble',
      onChange: () => {
        changed++
      },
      // 親が毎回作り直す想定。memo が外れないことも測る
      onGenerate: () => {},
    }
    const { svg, root } = await mount(props)
    layout(svg)
    expect(svg.querySelectorAll('[data-panel-id]')).toHaveLength(ROWS * COLUMNS)
    expect(svg.querySelectorAll('[data-bubble-id]')).toHaveLength(BUBBLES)
    expect(svg.querySelectorAll('image')).toHaveLength(ROWS * COLUMNS)

    // bb_8 は 2 行目 3 列目のコマの中央
    const nx = (dx: number) => panel.rect.x + panel.rect.w * (0.5 + dx)
    const ny = panel.rect.y + panel.rect.h * 0.5
    const pageLayer = svg.querySelector('[data-layer="page"]') as Element
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((records) => mutations.push(...records))
    observer.observe(pageLayer, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })

    const frames: number[] = []
    timed(svg, pointer('pointerdown', { id: 1, ...clientAt(nx(0), ny) }))
    for (let i = 1; i <= MOVES; i++) {
      frames.push(
        timed(svg, pointer('pointermove', { id: 1, ...clientAt(nx((0.3 * i) / MOVES), ny) })),
      )
    }
    await Promise.resolve()
    observer.disconnect()
    expect(svg.querySelector('[data-layer="bubble-tool"][data-draft="bb_8"]')).not.toBeNull()
    // ドラッグ中はページの描画に触らず、破線の下書きだけを描き直す
    expect(mutations).toHaveLength(0)

    const p95 = percentile(frames, 0.95)
    const median = percentile(frames, 0.5)
    console.info(
      `drag: ${MOVES} moves, median ${median.toFixed(2)}ms, p95 ${p95.toFixed(2)}ms, max ${Math.max(...frames).toFixed(2)}ms`,
    )
    expectWithinFrame(p95)

    // pointerup の Patch を親が適用したあとの 1 回の描画も 1 フレームに収め、動かしたフキダシだけを描き直す
    await act(async () => root.render(<EditorCanvas {...props} onGenerate={() => {}} />))
    timed(svg, pointer('pointerup', { id: 1, ...clientAt(nx(0.3), ny) }))
    expect(changed).toBe(1)
    const touched = new Set<Element>()
    const after = new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target instanceof Element ? r.target : r.target.parentElement
        const owner = el?.closest('[data-bubble-id], [data-panel-id], [data-overlay-panel-id]')
        if (owner) touched.add(owner)
      }
    })
    after.observe(pageLayer, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    const start = performance.now()
    act(() => root.render(<EditorCanvas {...props} page={next} onGenerate={() => {}} />))
    const commitMs = performance.now() - start
    await Promise.resolve()
    after.disconnect()
    console.info(`commit after drag: ${commitMs.toFixed(2)}ms`)
    expectWithinFrame(commitMs)
    expect([...touched].map((el) => el.getAttribute('data-bubble-id'))).toEqual(['bb_8'])
  })

  const STROKES = 500
  const STROKE_POINTS = 40

  /** 1 ページに 500 本。1 本は 40 点の波線で、ページ全体に散らす */
  function scribbledPage(): Page {
    const scribbles: Stroke[] = []
    for (let i = 0; i < STROKES; i++) {
      const x0 = (i % 20) / 20
      const y0 = Math.floor(i / 20) / 25
      scribbles.push({
        id: `st_${i + 1}`,
        points: Array.from({ length: STROKE_POINTS }, (_, j) => ({
          x: x0 + (0.04 * j) / STROKE_POINTS,
          y: y0 + 0.01 * Math.sin(j / 3),
        })),
        width: 0.002,
        color: (['ink', 'red', 'blue'] as const)[i % 3] ?? 'ink',
      })
    }
    return { ...bigPage(), scribbles }
  }

  test(`drawing on a page with ${STROKES} strokes stays within ${FRAME_MS}ms per frame`, async () => {
    const page = scribbledPage()
    let added: Stroke | undefined
    const props: EditorCanvasProps = {
      ...defaults,
      page,
      tool: 'scribble',
      scribbleTool: 'red',
      onChange: (patch) => {
        const op = patch[0]
        if (op?.op === 'add') added = op.value as Stroke
      },
      onGenerate: () => {},
    }
    const { svg, root } = await mount(props)
    layout(svg)
    const layer = svg.querySelector('[data-layer="scribble"]') as Element
    expect(layer.querySelectorAll('[data-stroke-id]')).toHaveLength(STROKES)

    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((records) =>
      mutations.push(
        ...records.filter(
          (r) => !(r.target instanceof Element && r.target.hasAttribute('data-live-stroke')),
        ),
      ),
    )
    observer.observe(svg, { subtree: true, childList: true, attributes: true, characterData: true })

    const frames: number[] = []
    timed(svg, pointer('pointerdown', { id: 1, ...clientAt(0.1, 0.5) }))
    for (let i = 1; i <= MOVES; i++) {
      frames.push(
        timed(svg, pointer('pointermove', { id: 1, ...clientAt(0.1 + (0.6 * i) / MOVES, 0.5) })),
      )
    }
    await Promise.resolve()
    observer.disconnect()
    const live = layer.querySelector('[data-live-stroke]') as SVGPolylineElement
    expect(live.getAttribute('points')?.split(' ').length).toBeGreaterThan(1)
    // 描いている間は描画中の線の points だけを書き換え、React は何も描き直さない
    expect(mutations).toHaveLength(0)

    const p95 = percentile(frames, 0.95)
    const median = percentile(frames, 0.5)
    console.info(
      `scribble: ${MOVES} moves on ${STROKES} strokes, median ${median.toFixed(2)}ms, p95 ${p95.toFixed(2)}ms, max ${Math.max(...frames).toFixed(2)}ms`,
    )
    expectWithinFrame(p95)

    timed(svg, pointer('pointerup', { id: 1, ...clientAt(0.7, 0.5) }))
    expect(added).toBeDefined()
    // pointerup の Patch を親が適用したあとの 1 回の描画も 1 フレームに収め、足した線だけを描く
    const next: Page = { ...page, scribbles: [...page.scribbles, added as Stroke] }
    const after: MutationRecord[] = []
    const commitObserver = new MutationObserver((records) => after.push(...records))
    commitObserver.observe(layer, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    })
    const start = performance.now()
    act(() => root.render(<EditorCanvas {...props} page={next} />))
    const commitMs = performance.now() - start
    await Promise.resolve()
    commitObserver.disconnect()
    console.info(`commit after stroke: ${commitMs.toFixed(2)}ms`)
    expectWithinFrame(commitMs)
    expect(after.flatMap((r) => [...r.addedNodes, ...r.removedNodes])).toEqual([
      layer.querySelector(`[data-stroke-id="${added?.id}"]`),
    ])
    expect(after.filter((r) => r.type !== 'childList')).toHaveLength(0)
  })
}
