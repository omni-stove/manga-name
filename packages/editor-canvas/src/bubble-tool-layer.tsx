import { m } from '@manga/i18n'
import type { BubbleHandle } from './bubble-ops'
import { bodyPath, bubbleGeometry, tailPaths } from './bubble-shape'
import { GUIDE } from './page-layer'
import { type BubbleDraft, bubbleHandles } from './use-bubble-tool'

const CURSORS: Record<BubbleHandle, string> = {
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
}

const line = {
  style: { fill: GUIDE, stroke: GUIDE },
  fillOpacity: 0.08,
  strokeWidth: 1.5,
  vectorEffect: 'non-scaling-stroke',
  pointerEvents: 'none',
} as const

/**
 * `bubble` ツールの UI。ドラッグ中は移動、リサイズ、しっぽの変更後の輪郭を破線で描き、
 * それ以外は選択中のフキダシに隅のリサイズハンドルと、しっぽごとの先端のハンドルを出す。
 * それとは別に、ドラッグで新しいしっぽを足す破線の丸を出す。しっぽの付かない形にはどちらも出さない
 */
export function BubbleToolLayer({
  selected,
  draft,
  handleSize,
}: {
  selected: BubbleDraft | undefined
  draft: BubbleDraft | null
  handleSize: number
}) {
  if (draft) {
    const g = bubbleGeometry(draft.bubble, draft.panel)
    return (
      <g data-layer="bubble-tool" data-draft={draft.bubble.id}>
        {tailPaths(draft.bubble.shape, g).map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 先端の重なったしっぽは同じ d になるので、位置で見分ける
          <path key={i} d={d} strokeDasharray="4 2" {...line} />
        ))}
        <path d={bodyPath(draft.bubble.shape, g)} strokeDasharray="4 2" {...line} />
      </g>
    )
  }
  if (!selected) return null
  const { corners, tails, add } = bubbleHandles(selected.bubble, selected.panel)
  const g = bubbleGeometry(selected.bubble, selected.panel)
  return (
    <g data-layer="bubble-tool">
      <rect
        x={g.cx - g.rx}
        y={g.cy - g.ry}
        width={g.rx * 2}
        height={g.ry * 2}
        fill="none"
        strokeWidth={1}
        strokeDasharray="2 2"
        style={{ stroke: GUIDE }}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      {corners.map((c) => (
        <rect
          key={c.handle}
          data-handle={c.handle}
          x={c.x - handleSize / 2}
          y={c.y - handleSize / 2}
          width={handleSize}
          height={handleSize}
          fill="#fff"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          style={{ stroke: GUIDE, cursor: CURSORS[c.handle] }}
        />
      ))}
      {tails.map((t) => (
        <circle
          key={t.index}
          data-tail-handle="set"
          data-tail-index={t.index}
          cx={t.x}
          cy={t.y}
          r={handleSize / 2}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          style={{ fill: GUIDE, stroke: GUIDE, cursor: 'move' }}
        >
          <title>{m.editor_canvas_bubble_tail_tip()}</title>
        </circle>
      ))}
      {add && (
        <circle
          data-tail-handle="unset"
          cx={add.x}
          cy={add.y}
          r={handleSize / 2}
          fill="#fff"
          strokeWidth={1}
          strokeDasharray="2 1"
          vectorEffect="non-scaling-stroke"
          style={{ stroke: GUIDE, cursor: 'move' }}
        >
          <title>{m.editor_canvas_bubble_tail_drag()}</title>
        </circle>
      )}
    </g>
  )
}
