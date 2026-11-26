import { innerFrameOf, type Page } from '@manga/schema'

/** 印刷所が断裁のずれに見込む塗り足し（mm） */
const BLEED = 3
/**
 * 3 本を濃さで見分ける無彩色。値は @manga/ui の tokens.css が持つ。
 * 選択枠の GUIDE を使わないのは、常に出ている枠線と選んだコマが同じ青で紛れるため
 */
const STROKES = {
  bleed: 'var(--frame-bleed)',
  trim: 'var(--frame-trim)',
  inner: 'var(--frame-inner)',
} as const
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
    <g data-layer="frames" pointerEvents="none">
      <rect
        data-frame="bleed"
        x={-BLEED}
        y={-BLEED}
        width={width + BLEED * 2}
        height={height + BLEED * 2}
        strokeDasharray="4 3"
        style={{ stroke: STROKES.bleed }}
        {...line}
      />
      <rect
        data-frame="trim"
        x={0}
        y={0}
        width={width}
        height={height}
        style={{ stroke: STROKES.trim }}
        {...line}
      />
      <rect
        data-frame="inner"
        x={inner.x}
        y={inner.y}
        width={inner.w}
        height={inner.h}
        style={{ stroke: STROKES.inner }}
        {...line}
      />
      {page.spread && (
        <line
          data-frame="gutter"
          x1={width / 2}
          y1={-BLEED}
          x2={width / 2}
          y2={height + BLEED}
          strokeDasharray="4 3"
          style={{ stroke: STROKES.inner }}
          {...line}
        />
      )}
    </g>
  )
}
