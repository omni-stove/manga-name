import { GUIDE } from './page-layer'
import type { BreakoutDraft } from './use-breakout-tool'

/**
 * 描きかけのはみ出しの多角形。置いた頂点を結ぶ折れ線と、最後の頂点からカーソルまでの線を破線で描く。
 * 最初の頂点は閉じる位置として、掴める大きさ closeSize の円で示す
 */
export function BreakoutToolLayer({
  draft,
  width,
  height,
  closeSize,
}: {
  draft: BreakoutDraft
  /** ページの大きさ（mm） */
  width: number
  height: number
  closeSize: number
}) {
  const points = draft.points.map((p) => ({ x: p.x * width, y: p.y * height }))
  const cursor = draft.cursor && { x: draft.cursor.x * width, y: draft.cursor.y * height }
  const path = [...points, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')
  const first = points[0]
  return (
    <g data-layer="breakout-tool" data-draft-breakout={draft.panelId} pointerEvents="none">
      {points.length > 0 && (
        <polyline
          points={path}
          style={{ fill: GUIDE, stroke: GUIDE }}
          fillOpacity={0.08}
          strokeWidth={1.5}
          strokeDasharray="4 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {first && points.length >= 3 && (
        <circle
          data-breakout-close=""
          cx={first.x}
          cy={first.y}
          r={closeSize}
          fill="none"
          style={{ stroke: GUIDE }}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {points.map((p, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: 頂点は置いた順で決まる
          key={i}
          data-breakout-vertex={i}
          cx={p.x}
          cy={p.y}
          r={closeSize / 3}
          style={{ fill: GUIDE }}
        />
      ))}
    </g>
  )
}
