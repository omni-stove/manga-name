import { GUIDE } from './page-layer'

/** 印刷所が断裁のずれに見込む塗り足し（mm） */
const BLEED = 3
/**
 * 内枠（基本枠）の幅と高さの、仕上がりに対する比率。B5 の投稿原稿の 182x257mm に対する 150x220mm で、
 * 他の判型でも同じ比率にする
 */
const INNER_W = 150 / 182
const INNER_H = 220 / 257

/** ページの大きさ（仕上がり、mm）に対する内枠。中央に置く */
function innerFrame(width: number, height: number) {
  const w = width * INNER_W
  const h = height * INNER_H
  return { x: (width - w) / 2, y: (height - h) / 2, w, h }
}

/**
 * タチキリ枠（仕上がりから BLEED 外側、破線）、外枠（仕上がり線）、内枠（基本枠）を描く。
 * 作業用の線なので出力には出さず、操作も受けない
 */
export function FrameLayer({ width, height }: { width: number; height: number }) {
  const inner = innerFrame(width, height)
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
