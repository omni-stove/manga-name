import { m } from '@manga/i18n'
import {
  BUBBLE_DASH,
  type Bubble,
  bubbleTextBox,
  clipTextBox,
  cornerAnchor,
  currentArt,
  type ID,
  INNER_FRAME,
  type Page,
  type Panel,
  type Point,
  type Rect,
  type ReferenceImage,
} from '@manga/schema'
import { memo, Suspense, use, useState } from 'react'
import { type AssetState, loadAsset } from './asset'
import { type Box, bubbleGeometry, bubblePaths } from './bubble-shape'
import { type PagePoint, panelBox, panelPolygon, polygonPoints } from './hit-test'
import type { Selection } from './types'
import { COLUMN_PITCH, layoutVertical } from './vertical-text'

export const FONT_FAMILY = '"Noto Sans JP", sans-serif'
/** 選択やコマ番号など、出力に出ない作業用の色。値は @manga/ui の tokens.css が持つ */
export const GUIDE = 'var(--guide)'
const NOTE_COLOR = 'var(--note)'
const NUMBER_RADIUS = 3.2
/**
 * これより小さいセリフは読めないとして警告する（mm）。印刷で読める下限とされる 7pt（約 2.47mm）。
 * 割り付けの下限 2mm まで縮めるのは、警告を出しつつ配置は崩さないため
 */
const LEGIBLE_FONT = 2.47
const ALERT_RADIUS = 2.4
/** フキダシの輪郭の太さ（画面の px） */
const BUBBLE_STROKE = 2

interface PageLayerProps {
  page: Page
  /** ページの大きさ（mm）。SVG のユーザー単位 */
  width: number
  height: number
  showArt: boolean
  /** 参考画像のレイヤーを出すか。出しても `page.reference.visible` が false なら隠す */
  showReference: boolean
  resolveAsset(ref: string): Promise<string>
  generating: Set<ID>
  generatingPage: boolean
  selection: Selection
  /** clipPath の id の接頭辞。同じ文書に複数のキャンバスがあっても衝突しない値 */
  idPrefix: string
  onGenerate?(panelId: ID): void
}

/**
 * ページの白地、参考画像、コマ、生成画像、フキダシを描く。ズームとパンとドラッグでは props が変わらないので、
 * memo で再描画を飛ばす。コマ、フキダシ、オーバーレイもそれぞれ memo し、編集や選択の変更では
 * 変わった要素だけを描き直す
 */
export const PageLayer = memo(function PageLayer(props: PageLayerProps) {
  const { page, width, height } = props
  return (
    <g data-layer="page">
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="#fff"
        style={{ stroke: 'var(--paper-edge)' }}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {props.showReference && page.reference && (
        <ReferenceView
          reference={page.reference}
          resolveAsset={props.resolveAsset}
          width={width}
          height={height}
        />
      )}
      {page.panels.map((panel, i) => {
        const ref = currentArt(panel)?.ref
        const { selection } = props
        return (
          <PanelView
            key={panel.id}
            panel={panel}
            width={width}
            height={height}
            artRef={props.showArt ? ref : undefined}
            resolveAsset={props.resolveAsset}
            generating={props.generating.has(panel.id)}
            selected={isSelected(selection, 'panel', panel.id)}
            // 他のコマのフキダシを選んでもこのコマを描き直さないよう、自分のフキダシのときだけ渡す
            selectedBubble={
              selection?.kind === 'bubble' && panel.bubbles.some((b) => b.id === selection.id)
                ? selection.id
                : undefined
            }
            clipId={`${props.idPrefix}-clip-${i}`}
          />
        )
      })}
      {/* はみ出したフキダシを後ろのコマが隠さないよう、全コマの後に描く。重なりの前後はレンダラと同じく order 順 */}
      {[...page.panels]
        .sort((a, b) => a.order - b.order)
        .map((panel) =>
          byOrder(panel.bubbles.filter((b) => b.overflow)).map((bubble) => (
            <BubbleView
              key={bubble.id}
              bubble={bubble}
              panelRect={panel.rect}
              width={width}
              height={height}
              selected={isSelected(props.selection, 'bubble', bubble.id)}
            />
          )),
        )}
      {/* スピナーと生成ボタンはエディタだけの UI なので、フキダシに隠れないよう最後に描く */}
      {page.panels.map((panel) => (
        <PanelOverlay
          key={panel.id}
          panelId={panel.id}
          panelRect={panel.rect}
          panelShape={panel.shape}
          width={width}
          height={height}
          generating={!props.generatingPage && props.generating.has(panel.id)}
          onGenerate={props.generatingPage ? undefined : props.onGenerate}
        />
      ))}
      {props.generatingPage && (
        <GeneratingOverlay
          rect={{ x: 0, y: 0, w: width, h: height }}
          points={`0,0 ${width},0 ${width},${height} 0,${height}`}
          label={m.editor_canvas_page_generating()}
        />
      )}
    </g>
  )
})

const isSelected = (selection: Selection, kind: 'panel' | 'bubble', id: ID) =>
  selection?.kind === kind && selection.id === id

const byOrder = (bubbles: Bubble[]) => [...bubbles].sort((a, b) => a.order - b.order)

const PanelView = memo(function PanelView({
  panel,
  width,
  height,
  artRef,
  resolveAsset,
  generating,
  selected,
  selectedBubble,
  clipId,
}: {
  panel: Panel
  width: number
  height: number
  artRef: string | undefined
  resolveAsset(ref: string): Promise<string>
  generating: boolean
  selected: boolean
  selectedBubble: ID | undefined
  clipId: string
}) {
  const rect = panelBox(panel, width, height)
  const outline = panelPolygon(panel, width, height)
  const points = polygonPoints(outline)
  const placeholder = (
    <g clipPath={`url(#${clipId})`}>
      <Placeholder panel={panel} rect={rect} error={false} />
    </g>
  )
  return (
    <g className="ec-panel" data-panel-id={panel.id} data-generating={generating || undefined}>
      <clipPath id={clipId}>
        <polygon points={points} />
      </clipPath>
      {artRef === undefined ? (
        placeholder
      ) : (
        <Suspense fallback={placeholder}>
          <PanelArt
            key={artRef}
            panel={panel}
            rect={rect}
            clipId={clipId}
            loaded={loadAsset(resolveAsset, artRef)}
          />
        </Suspense>
      )}
      <PanelNumber order={panel.order} outline={outline} />
      {/* 枠の外に出た部分をコマの輪郭で切り、切り口に枠線が重なるよう枠より先に描く */}
      {byOrder(panel.bubbles.filter((b) => !b.overflow)).map((bubble) => (
        <BubbleView
          key={bubble.id}
          bubble={bubble}
          panelRect={panel.rect}
          width={width}
          height={height}
          selected={bubble.id === selectedBubble}
          clipId={clipId}
        />
      ))}
      <polygon
        data-panel-frame=""
        points={points}
        fill="none"
        stroke="#000"
        style={selected ? { stroke: GUIDE } : undefined}
        data-selected={selected || undefined}
        strokeWidth={selected ? 2 : 1}
        strokeLinejoin="miter"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  )
})

/** コマの絵。解決か読み込みに失敗したら、エラーを添えたプレースホルダーに戻す */
function PanelArt({
  panel,
  rect,
  clipId,
  loaded,
}: {
  panel: Panel
  rect: Box
  clipId: string
  loaded: Promise<AssetState>
}) {
  const asset = use(loaded)
  const [broken, setBroken] = useState(false)
  if ('error' in asset || broken)
    return (
      <g clipPath={`url(#${clipId})`} data-art-error="">
        <Placeholder panel={panel} rect={rect} error />
      </g>
    )
  return (
    <image
      href={asset.url}
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
      preserveAspectRatio="xMidYMid slice"
      clipPath={`url(#${clipId})`}
      onError={() => setBroken(true)}
    />
  )
}

/** コマの上に重ねるスピナーと生成ボタン */
const PanelOverlay = memo(function PanelOverlay({
  panelId,
  panelRect,
  panelShape,
  width,
  height,
  generating,
  onGenerate,
}: {
  panelId: ID
  panelRect: Rect
  panelShape: Point[] | undefined
  width: number
  height: number
  generating: boolean
  onGenerate?(panelId: ID): void
}) {
  const rect = panelBox({ rect: panelRect }, width, height)
  const outline = panelPolygon({ rect: panelRect, shape: panelShape }, width, height)
  const points = polygonPoints(outline)
  return (
    <g className="ec-overlay" data-overlay-panel-id={panelId}>
      {/* フキダシの上でも .ec-overlay:hover を効かせるための当たり判定 */}
      <polygon points={points} fill="transparent" />
      {generating && (
        <GeneratingOverlay rect={rect} points={points} label={m.editor_canvas_panel_generating()} />
      )}
      {onGenerate && !generating && (
        <GenerateButton outline={outline} onClick={() => onGenerate(panelId)} />
      )}
    </g>
  )
})

/**
 * ページ全体にアスペクト比を保って中央に収めた参考画像。コマは塗らないので、未生成のコマ越しに見える
 */
function ReferenceView({
  reference,
  resolveAsset,
  width,
  height,
}: {
  reference: ReferenceImage
  resolveAsset(ref: string): Promise<string>
  width: number
  height: number
}) {
  return (
    <g data-layer="reference">
      <Suspense>
        <ReferenceArt
          key={reference.ref}
          reference={reference}
          loaded={loadAsset(resolveAsset, reference.ref)}
          width={width}
          height={height}
        />
      </Suspense>
    </g>
  )
}

function ReferenceArt({
  reference,
  loaded,
  width,
  height,
}: {
  reference: ReferenceImage
  loaded: Promise<AssetState>
  width: number
  height: number
}) {
  const asset = use(loaded)
  const [broken, setBroken] = useState(false)
  if ('error' in asset || broken) return null
  return (
    <image
      href={asset.url}
      x={0}
      y={0}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      opacity={reference.opacity}
      visibility={reference.visible ? 'visible' : 'hidden'}
      pointerEvents="none"
      onError={() => setBroken(true)}
    />
  )
}

/** 未生成コマの中身。camera と note を灰色の横書きで、コマに収まるぶんだけ出す */
function Placeholder({ panel, rect, error }: { panel: Panel; rect: Box; error: boolean }) {
  if (!panel.camera && !panel.note && !error) return null
  return (
    <foreignObject x={rect.x} y={rect.y} width={rect.w} height={rect.h} data-placeholder="">
      <div
        style={{
          boxSizing: 'border-box',
          height: '100%',
          overflow: 'hidden',
          padding: `1.5px ${NUMBER_RADIUS * 2 + 2}px 1.5px 1.5px`,
          color: NOTE_COLOR,
          fontFamily: FONT_FAMILY,
          fontSize: '2.6px',
          lineHeight: 1.4,
          overflowWrap: 'anywhere',
        }}
      >
        {error && (
          <div style={{ color: 'var(--alert)' }}>{m.editor_canvas_panel_image_load_failed()}</div>
        )}
        {panel.camera && <div>[{panel.camera}]</div>}
        {panel.note && <div>{panel.note}</div>}
      </div>
    </foreignObject>
  )
}

/** 右上の丸の番号。出力のコマ番号とは別の、作業用の印 */
function PanelNumber({ order, outline }: { order: number; outline: readonly PagePoint[] }) {
  const r = NUMBER_RADIUS
  const { x: cx, y: cy } = cornerAnchor(outline, 'ne', -(r + 1), r + 1)
  return (
    <g data-panel-number={order}>
      <circle cx={cx} cy={cy} r={r} style={{ fill: GUIDE }} />
      <text
        x={cx}
        y={cy}
        style={{ fill: 'var(--on-guide)' }}
        fontFamily={FONT_FAMILY}
        fontSize={r * 1.1}
        fontWeight="bold"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {order}
      </text>
    </g>
  )
}

/** 半透明の白と回るスピナー */
function GeneratingOverlay({ rect, points, label }: { rect: Box; points: string; label: string }) {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const r = Math.min(12, Math.max(3, Math.min(rect.w, rect.h) * 0.12))
  return (
    <g data-spinner="" aria-label={label}>
      <polygon points={points} fill="#fff" opacity={0.6} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        style={{ stroke: 'var(--guide-soft)' }}
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        style={{ stroke: GUIDE }}
        strokeWidth={3}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={`0 ${cx} ${cy}`}
          to={`360 ${cx} ${cy}`}
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </g>
  )
}

/** コマのホバーで出す「生成」ボタン。右下に置く */
function GenerateButton({ outline, onClick }: { outline: readonly PagePoint[]; onClick(): void }) {
  const w = 12
  const h = 5
  const center = cornerAnchor(outline, 'se', -(w / 2 + 1.5), -(h / 2 + 1.5))
  const x = center.x - w / 2
  const y = center.y - h / 2
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG の中に <button> は置けない
    <g
      className="ec-generate"
      role="button"
      tabIndex={0}
      aria-label={m.editor_canvas_panel_generate_aria()}
      style={{ cursor: 'pointer' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onClick()
      }}
    >
      <rect x={x} y={y} width={w} height={h} rx={1} style={{ fill: GUIDE }} />
      <text
        x={x + w / 2}
        y={y + h / 2}
        style={{ fill: 'var(--on-guide)' }}
        fontFamily={FONT_FAMILY}
        fontSize={2.6}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {m.editor_canvas_panel_generate()}
      </text>
    </g>
  )
}

/**
 * フキダシ。太線で輪郭を描いてから同じ形を白で塗り重ね、本体としっぽの継ぎ目の線を消す。
 * 外側に残る線は太線の半分になる。枠なしは何も描かない代わりに、選択していなくても薄い破線で範囲を示す。
 * clipId を渡すと、輪郭と文字をその clipPath で切る。フキダシは内枠の外に出てよいが、セリフは断裁で
 * 切れないよう内枠の内側に寄せる
 */
const BubbleView = memo(function BubbleView({
  bubble,
  panelRect,
  width,
  height,
  selected,
  clipId,
}: {
  bubble: Bubble
  panelRect: Rect
  width: number
  height: number
  selected: boolean
  clipId?: string
}) {
  const panel = panelBox({ rect: panelRect }, width, height)
  const g = bubbleGeometry(bubble, panel)
  const paths = bubblePaths(bubble.shape, g)
  const text = bubbleTextBox(bubble.shape, g)
  const box = clipTextBox(
    clipId ? clipTextBox(text, panel) : text,
    panelBox({ rect: INNER_FRAME }, width, height),
  )
  const layout = layoutVertical(bubble.text, box)
  const pitch = layout.fontSize * COLUMN_PITCH
  const blockWidth =
    layout.columns.length === 0 ? 0 : (layout.columns.length - 1) * pitch + layout.fontSize
  const right = box.x + box.w / 2 + blockWidth / 2 - layout.fontSize / 2
  const shapes = paths.tail === null ? [paths.body] : [paths.tail, paths.body]
  const illegible =
    layout.columns.length > 0 && (layout.truncated || layout.fontSize < LEGIBLE_FONT)
  return (
    <g className="ec-bubble" data-bubble-id={bubble.id} data-shape={bubble.shape}>
      <g clipPath={clipId && `url(#${clipId})`}>
        {paths.line !== 'none' &&
          shapes.map((d) => (
            <path
              key={`stroke-${d}`}
              d={d}
              fill="#fff"
              stroke="#000"
              strokeWidth={BUBBLE_STROKE}
              strokeDasharray={
                paths.line === 'dashed'
                  ? BUBBLE_DASH.map((n) => n * BUBBLE_STROKE).join(' ')
                  : undefined
              }
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {paths.fill && shapes.map((d) => <path key={`fill-${d}`} d={d} fill="#fff" />)}
        {paths.ink !== null && <path d={paths.ink} fill="#000" />}
        {layout.columns.length > 0 && (
          <text
            writingMode="vertical-rl"
            fontFamily={FONT_FAMILY}
            fontSize={layout.fontSize}
            textAnchor="middle"
            fill="#000"
            data-truncated={layout.truncated || undefined}
          >
            {layout.columns.map((column, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 列は位置で決まり、同じ文字列の列も並びうる
              <tspan key={i} x={right - i * pitch} y={box.y + box.h / 2}>
                {column}
              </tspan>
            ))}
          </text>
        )}
      </g>
      {selected ? (
        <path
          d={paths.body}
          fill="none"
          style={{ stroke: GUIDE }}
          strokeWidth={2}
          strokeDasharray="4 2"
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        !paths.fill && (
          <path
            d={paths.body}
            fill="none"
            style={{ stroke: GUIDE }}
            strokeWidth={1}
            strokeDasharray="2 2"
            strokeOpacity={0.5}
            vectorEffect="non-scaling-stroke"
            data-bubble-guide
          />
        )
      )}
      <text
        x={g.cx + g.rx}
        y={g.cy - g.ry}
        style={{ fill: GUIDE }}
        fontFamily={FONT_FAMILY}
        fontSize={2.2}
        textAnchor="middle"
        data-bubble-order={bubble.order}
      >
        {bubble.order}
      </text>
      {illegible && <IllegibleAlert x={g.cx - g.rx} y={g.cy - g.ry} truncated={layout.truncated} />}
    </g>
  )
})

/** 文字が小さすぎるか収まらないフキダシの左上に出す、出力に出ない警告の印 */
function IllegibleAlert({ x, y, truncated }: { x: number; y: number; truncated: boolean }) {
  const message = truncated
    ? m.editor_canvas_bubble_text_truncated()
    : m.editor_canvas_bubble_text_too_small()
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG の <g> に <img> は使えず、role="img" で名前を伝える
    // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: biome が <g> を対話要素と誤判定する。警告の印は操作できず、名前だけを伝える
    <g role="img" aria-label={message} data-bubble-alert={truncated ? 'truncated' : 'small'}>
      <title>{message}</title>
      <circle cx={x} cy={y} r={ALERT_RADIUS} style={{ fill: 'var(--alert)' }} />
      <text
        x={x}
        y={y}
        style={{ fill: 'var(--on-alert)' }}
        fontFamily={FONT_FAMILY}
        fontSize={ALERT_RADIUS * 1.4}
        fontWeight="bold"
        textAnchor="middle"
        dominantBaseline="central"
      >
        !
      </text>
    </g>
  )
}
