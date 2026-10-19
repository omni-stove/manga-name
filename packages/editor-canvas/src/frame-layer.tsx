import { innerFrameOf, type Page } from '@manga/schema'
import { GUIDE } from './page-layer'

/** 印刷所が断裁のずれに見込む塗り足し（mm） */
const BLEED = 3
/**
 * タチキリ枠（仕上がりから BLEED 外側、破線）、外枠（仕上がり線）、内枠（基本枠）を描く。見開きならノド（中央の折り目）も破線で引く。
 * 作業用の線なので出力には出さず、操作も受けない
 */
export function FrameLayer({
  page,
  width,
  height,
}: {
  page: Pick<Page, 'spread'>
  width: number
  height: number
}) {
  const frame = innerFrameOf(page)
  const inner = {
    x: frame.x * width,
    y: frame.y * height,
    w: frame.w * width,
    h: frame.h * height,
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
      {page.spread && (
        <line
          data-frame="gutter"
          x1={width / 2}
          y1={-BLEED}
          x2={width / 2}
          y2={height + BLEED}
          strokeDasharray="4 3"
          {...line}
        />
      )}
    </g>
  )
}
