import type { BubbleHandle } from './bubble-ops'
import { bodyPath, bubbleGeometry, tailPath } from './bubble-shape'
import { SELECTED } from './page-layer'
import { type BubbleDraft, bubbleHandles } from './use-bubble-tool'

const CURSORS: Record<BubbleHandle, string> = {
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
}

const line = {
  stroke: SELECTED,
  strokeWidth: 1.5,
  vectorEffect: 'non-scaling-stroke',
  pointerEvents: 'none',
} as const

/**
 * `bubble` ツールの UI。ドラッグ中は移動、リサイズ、しっぽの変更後の輪郭を破線で描き、
 * それ以外は選択中のフキダシに隅のリサイズハンドルとしっぽの先端のハンドルを出す。
 * しっぽが無いときの先端のハンドルは破線の丸で、ドラッグするとしっぽができる
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
    const tail = tailPath(draft.bubble.shape, g)
    return (
      <g data-layer="bubble-tool" data-draft={draft.bubble.id}>
        {tail !== null && (
          <path d={tail} fill={SELECTED} fillOpacity={0.08} strokeDasharray="4 2" {...line} />
        )}
        <path
          d={bodyPath(draft.bubble.shape, g)}
          fill={SELECTED}
          fillOpacity={0.08}
          strokeDasharray="4 2"
          {...line}
        />
      </g>
    )
  }
  if (!selected) return null
  const { corners, tail } = bubbleHandles(selected.bubble, selected.panel)
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
        stroke={SELECTED}
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
          stroke={SELECTED}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: CURSORS[c.handle] }}
        />
      ))}
      <circle
        data-tail-handle={tail.set ? 'set' : 'unset'}
        cx={tail.x}
        cy={tail.y}
        r={handleSize / 2}
        fill={tail.set ? SELECTED : '#fff'}
        stroke={SELECTED}
        strokeWidth={1}
        strokeDasharray={tail.set ? undefined : '2 1'}
        vectorEffect="non-scaling-stroke"
        style={{ cursor: 'move' }}
      >
        <title>{tail.set ? 'しっぽの先端' : 'ドラッグでしっぽを付ける'}</title>
      </circle>
    </g>
  )
}
