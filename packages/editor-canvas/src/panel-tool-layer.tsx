import type { Panel } from '@manga/schema'
import { panelBox } from './hit-test'
import { FONT_FAMILY, SELECTED } from './page-layer'
import type { Handle, SplitAxis } from './panel-ops'
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
 * `panel` ツールの UI。ドラッグ中は作成やリサイズ後の矩形を破線で描き、それ以外は選択中のコマに
 * リサイズのハンドルと分割ボタンを出す
 */
export function PanelToolLayer({
  selected,
  draft,
  width,
  height,
  handleSize,
  onSplit,
}: {
  selected: Panel | undefined
  draft: Draft | null
  /** ページの大きさ（mm） */
  width: number
  height: number
  handleSize: number
  onSplit(axis: SplitAxis): void
}) {
  if (draft) {
    const { x, y, w, h } = draft.rect
    return (
      <g data-layer="panel-tool">
        <rect
          data-draft={draft.panelId ?? 'new'}
          x={x * width}
          y={y * height}
          width={w * width}
          height={h * height}
          fill={SELECTED}
          fillOpacity={0.08}
          stroke={SELECTED}
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
          stroke={SELECTED}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: CURSORS[h.handle] }}
        />
      ))}
      <ToolButton x={bx} y={by} axis="vertical" label="左右に分割" onClick={onSplit} />
      <ToolButton
        x={bx + BUTTON_W + 1.5}
        y={by}
        axis="horizontal"
        label="上下に分割"
        onClick={onSplit}
      />
    </g>
  )
}

function ToolButton({
  x,
  y,
  axis,
  label,
  onClick,
}: {
  x: number
  y: number
  axis: SplitAxis
  label: string
  onClick(axis: SplitAxis): void
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG の中に <button> は置けない
    <g
      role="button"
      tabIndex={0}
      aria-label={`コマを${label}`}
      data-split={axis}
      style={{ cursor: 'pointer' }}
      // キャンバスにコマの作成として拾わせない
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => onClick(axis)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onClick(axis)
      }}
    >
      <rect x={x} y={y} width={BUTTON_W} height={BUTTON_H} rx={1} fill={SELECTED} />
      <text
        x={x + BUTTON_W / 2}
        y={y + BUTTON_H / 2}
        fill="#fff"
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
