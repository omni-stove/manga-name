import { m } from '@manga/i18n'
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

const BUTTON_H = 5
const BUTTON_FONT_SIZE = 2.4
/** ボタンの文字の左右の余白 */
const BUTTON_PAD = 1
const BUTTON_GAP = 1.5
/** コマの右下に出る「生成」ボタン（page-layer の GenerateButton）の幅と余白。分割と結合のボタンはここへ入れない */
const GENERATE_SPACE = 12 + 1.5 + BUTTON_GAP
/** 分割と結合のボタンをコマの左下から離す距離。左下のハンドルと掴む範囲が重ならないようにする */
const BUTTON_INSET = 4

/**
 * `panel` ツールの UI。ドラッグ中は作成、リサイズ、頂点の移動の後の輪郭か、分割線がコマを横切る区間を
 * 破線で描く。それ以外は選択中のコマにリサイズのハンドル、多角形なら頂点のハンドル、分割と結合のボタンを出す。
 * 位置をロックしたコマにはハンドルを出さない
 */
export function PanelToolLayer({
  selected,
  draft,
  width,
  height,
  handleSize,
  cutting,
  merging,
  onSplit,
  onToggleCut,
  onToggleMerge,
}: {
  selected: Panel | undefined
  draft: Draft | null
  /** ページの大きさ（mm） */
  width: number
  height: number
  handleSize: number
  /** 線で割るモードの最中か */
  cutting: boolean
  /** 次に押したコマと結合するモードの最中か */
  merging: boolean
  onSplit(axis: SplitAxis): void
  onToggleCut(): void
  onToggleMerge(): void
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
  const left = box.x + BUTTON_INSET
  const right = Math.max(left, box.x + box.w - GENERATE_SPACE)
  const bottom = box.y + box.h - BUTTON_H - BUTTON_INSET
  const vertices = selected.shape && !selected.locked ? panelPolygon(selected, width, height) : []
  // 押下中に文字が変わっても後ろのボタンが動かないよう、幅は長い方の文字に合わせる。
  // 1 行に収まらなければ上の行へ折り返す
  const buttons = [
    { labels: [m.editor_canvas_panel_split_vertical()] },
    { labels: [m.editor_canvas_panel_split_horizontal()] },
    { labels: [m.editor_canvas_panel_cut(), m.editor_canvas_panel_cutting()] },
    { labels: [m.editor_canvas_panel_merge(), m.editor_canvas_panel_merging()] },
  ].reduce<Slot[]>((acc, { labels }) => {
    const w = buttonWidth(labels)
    const prev = acc.at(-1)
    if (!prev) {
      acc.push({ x: left, y: bottom, w })
      return acc
    }
    const x = prev.x + prev.w + BUTTON_GAP
    acc.push(
      x + w <= right ? { x, y: prev.y, w } : { x: left, y: prev.y - BUTTON_H - BUTTON_GAP, w },
    )
    return acc
  }, [])
  const [vertical, horizontal, cut, merge] = buttons as [Slot, Slot, Slot, Slot]
  return (
    <g data-layer="panel-tool">
      {(selected.locked ? [] : handlePoints(box)).map((h) => (
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
        {...vertical}
        label={m.editor_canvas_panel_split_vertical()}
        ariaLabel={m.editor_canvas_panel_split_vertical_aria()}
        data={{ 'data-split': 'vertical' }}
        onClick={() => onSplit('vertical')}
      />
      <ToolButton
        {...horizontal}
        label={m.editor_canvas_panel_split_horizontal()}
        ariaLabel={m.editor_canvas_panel_split_horizontal_aria()}
        data={{ 'data-split': 'horizontal' }}
        onClick={() => onSplit('horizontal')}
      />
      <ToolButton
        {...cut}
        label={cutting ? m.editor_canvas_panel_cutting() : m.editor_canvas_panel_cut()}
        ariaLabel={
          cutting ? m.editor_canvas_panel_cutting_aria() : m.editor_canvas_panel_cut_aria()
        }
        pressed={cutting}
        data={{ 'data-cut': '' }}
        onClick={onToggleCut}
      />
      <ToolButton
        {...merge}
        label={merging ? m.editor_canvas_panel_merging() : m.editor_canvas_panel_merge()}
        ariaLabel={
          merging ? m.editor_canvas_panel_merging_aria() : m.editor_canvas_panel_merge_aria()
        }
        pressed={merging}
        data={{ 'data-merge': '' }}
        onClick={onToggleMerge}
      />
    </g>
  )
}

type Slot = { x: number; y: number; w: number }

/** labels のどれを出しても収まるボタンの幅。日本語の文字は 1 文字を 1em とみなす */
function buttonWidth(labels: readonly string[]): number {
  return Math.max(...labels.map((l) => l.length)) * BUTTON_FONT_SIZE + BUTTON_PAD * 2
}

function ToolButton({
  x,
  w,
  y,
  label,
  ariaLabel,
  pressed,
  data,
  onClick,
}: {
  x: number
  w: number
  y: number
  label: string
  ariaLabel: string
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
      aria-label={ariaLabel}
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
        width={w}
        height={BUTTON_H}
        rx={1}
        // 押下中は白地に枠と文字を GUIDE で描き、押していないボタンと見分ける
        style={pressed ? { fill: '#fff', stroke: GUIDE } : { fill: GUIDE }}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={x + w / 2}
        y={y + BUTTON_H / 2}
        style={{ fill: pressed ? GUIDE : 'var(--on-guide)' }}
        fontFamily={FONT_FAMILY}
        fontSize={BUTTON_FONT_SIZE}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {label}
      </text>
    </g>
  )
}
