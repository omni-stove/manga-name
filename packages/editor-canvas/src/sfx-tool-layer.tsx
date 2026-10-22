import { m } from '@manga/i18n'
import { GUIDE } from './page-layer'
import { sfxPoint } from './sfx-ops'
import type { SfxRotation } from './use-hint-tool'

/**
 * `focus` ツールで選んだ描き文字の UI。描き文字を囲む破線の枠と、その上端から伸ばした回転のハンドルを、
 * 描き文字と同じ傾きで出す。ドラッグ中は回した後の傾きで出す
 */
export function SfxToolLayer({
  rotation,
  handleSize,
}: {
  rotation: SfxRotation | undefined
  handleSize: number
}) {
  if (!rotation) return null
  const { frame, handle } = rotation
  // 字の白いふちに枠が重ならないよう、ハンドルの半径だけ外に広げる
  const pad = handleSize / 2
  const halfW = frame.w / 2 + pad
  const halfH = frame.h / 2 + pad
  const corners = [
    sfxPoint(frame, -halfW, -halfH),
    sfxPoint(frame, halfW, -halfH),
    sfxPoint(frame, halfW, halfH),
    sfxPoint(frame, -halfW, halfH),
  ]
  const top = sfxPoint(frame, 0, -halfH)
  return (
    <g data-layer="sfx-tool" data-rotation={frame.rotation}>
      <polygon
        points={corners.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        strokeWidth={1}
        strokeDasharray="2 2"
        style={{ stroke: GUIDE }}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      <line
        x1={top.x}
        y1={top.y}
        x2={handle.x}
        y2={handle.y}
        strokeWidth={1}
        style={{ stroke: GUIDE }}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      <circle
        data-rotate-handle
        cx={handle.x}
        cy={handle.y}
        r={handleSize / 2}
        fill="#fff"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        style={{ stroke: GUIDE, cursor: 'grab' }}
      >
        <title>{m.editor_canvas_sfx_rotate()}</title>
      </circle>
    </g>
  )
}
