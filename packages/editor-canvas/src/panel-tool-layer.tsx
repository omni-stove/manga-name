import type { Panel } from '@manga/schema'
import { panelBox, panelPolygon, polygonPoints } from './hit-test'
import { FONT_FAMILY, GUIDE } from './page-layer'
import { cutChord, type Handle, type SplitAxis } from './panel-ops'
import { type Draft, handlePoints } from './use-panel-tool'

const CURSORS: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
}

const BUTTON_W = 14
const BUTTON_H = 5
/** 分割ボタンをコマの左下から離す距離。左下のハンドルと掴む範囲が重ならないようにする */
const BUTTON_INSET = 4

/**
 * `panel` ツールの UI。ドラッグ中は作成、リサイズ、頂点の移動の後の輪郭か、分割線がコマを横切る区間を
 * 破線で描く。それ以外は選択中のコマにリサイズのハンドル、多角形なら頂点のハンドル、分割ボタンを出す
 */
export function PanelToolLayer({
  selected,
  draft,
  width,
  height,
  handleSize,
  cutting,
  onSplit,
  onToggleCut,
}: {
  selected: Panel | undefined
  draft: Draft | null
  /** ページの大きさ（mm） */
  width: number
  height: number
  handleSize: number
  /** 線で割るモードの最中か */
  cutting: boolean
  onSplit(axis: SplitAxis): void
  onToggleCut(): void
}) {
  if (draft?.kind === 'cut') {
    const chord = selected && cutChord(selected, draft.cut)
    return (
      <g data-layer="panel-tool">
        {chord && (
          <line
            data-draft-cut={draft.panelId}
            x1={chord[0].x * width}
            y1={chord[0].y * height}
            x2={chord[1].x * width}
            y2={chord[1].y * height}
            style={{ stroke: GUIDE }}
            strokeWidth={2}
            strokeDasharray="4 2"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
      </g>
    )
  }
  if (draft) {
    const outline = draft.outline.map((p) => ({ x: p.x * width, y: p.y * height }))
    return (
      <g data-layer="panel-tool">
        <polygon
          data-draft={draft.panelId ?? 'new'}
          points={polygonPoints(outline)}
          style={{ fill: GUIDE, stroke: GUIDE }}
          fillOpacity={0.08}
          strokeWidth={1.5}
          strokeDasharray="4 2"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      </g>
    )
  }
  if (!selected) return null
  const box = panelBox(selected, width, height)
  const bx = box.x + BUTTON_INSET
  const by = box.y + box.h - BUTTON_H - BUTTON_INSET
  const vertices = selected.shape ? panelPolygon(selected, width, height) : []
  return (
    <g data-layer="panel-tool">
      {handlePoints(box).map((h) => (
        <rect
          key={h.handle}
          data-handle={h.handle}
          x={h.x - handleSize / 2}
          y={h.y - handleSize / 2}
          width={handleSize}
          height={handleSize}
          fill="#fff"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          style={{ stroke: GUIDE, cursor: CURSORS[h.handle] }}
        />
      ))}
      {vertices.map((v, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: 頂点は輪郭の中の位置で決まる
          key={i}
          data-vertex={i}
          cx={v.x}
          cy={v.y}
          r={handleSize / 2}
          style={{ fill: GUIDE, cursor: 'move' }}
        />
      ))}
      <ToolButton
        x={bx}
        y={by}
        label="左右に分割"
        data={{ 'data-split': 'vertical' }}
        onClick={() => onSplit('vertical')}
      />
      <ToolButton
        x={bx + BUTTON_W + 1.5}
        y={by}
        label="上下に分割"
        data={{ 'data-split': 'horizontal' }}
        onClick={() => onSplit('horizontal')}
      />
      <ToolButton
        x={bx + (BUTTON_W + 1.5) * 2}
        y={by}
        label={cutting ? '線を引いて分割' : '線で分割'}
        ariaLabel={cutting ? '線で分割するのをやめる' : 'コマを線で分割'}
        pressed={cutting}
        data={{ 'data-cut': '' }}
        onClick={onToggleCut}
      />
    </g>
  )
}

function ToolButton({
  x,
  y,
  label,
  ariaLabel,
  pressed,
  data,
  onClick,
}: {
  x: number
  y: number
  label: string
  /** 省略時は「コマを{label}」 */
  ariaLabel?: string
  /** トグルボタンの押下状態。省略時は普通のボタン */
  pressed?: boolean
  data: Record<`data-${string}`, string>
  onClick(): void
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG の中に <button> は置けない
    <g
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? `コマを${label}`}
      aria-pressed={pressed}
      {...data}
      style={{ cursor: 'pointer' }}
      // キャンバスにコマの作成として拾わせない
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onClick()
      }}
    >
      <rect
        x={x}
        y={y}
        width={BUTTON_W}
        height={BUTTON_H}
        rx={1}
        style={{ fill: GUIDE }}
        fillOpacity={pressed ? 0.6 : 1}
      />
      <text
        x={x + BUTTON_W / 2}
        y={y + BUTTON_H / 2}
        style={{ fill: 'var(--on-guide)' }}
        fontFamily={FONT_FAMILY}
        fontSize={2.4}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {label}
      </text>
    </g>
  )
}
