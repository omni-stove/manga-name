import { INNER_FRAME } from '@manga/schema'
import { GUIDE } from './page-layer'

/** 印刷所が断裁のずれに見込む塗り足し（mm） */
const BLEED = 3
/**
 * タチキリ枠（仕上がりから BLEED 外側、破線）、外枠（仕上がり線）、内枠（基本枠）を描く。
 * 作業用の線なので出力には出さず、操作も受けない
 */
export function FrameLayer({ width, height }: { width: number; height: number }) {
  const inner = {
    x: INNER_FRAME.x * width,
    y: INNER_FRAME.y * height,
    w: INNER_FRAME.w * width,
    h: INNER_FRAME.h * height,
  }
  const line = {
    fill: 'none',
    strokeWidth: 1,
    vectorEffect: 'non-scaling-stroke',
  } as const
  return (
    <g data-layer="frames" pointerEvents="none" style={{ stroke: GUIDE }}>
      <rect
        data-frame="bleed"
        x={-BLEED}
        y={-BLEED}
        width={width + BLEED * 2}
        height={height + BLEED * 2}
        strokeDasharray="4 3"
        {...line}
      />
      <rect data-frame="trim" x={0} y={0} width={width} height={height} {...line} />
      <rect data-frame="inner" x={inner.x} y={inner.y} width={inner.w} height={inner.h} {...line} />
    </g>
  )
}
