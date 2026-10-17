import type { Page, Panel, Point } from '@manga/schema'
import { memo } from 'react'
import { bodyPath, bubbleGeometry } from './bubble-shape'
import { focusRadius, toPagePoint } from './hint-ops'
import { panelBox } from './hit-test'
import { GUIDE } from './page-layer'

// var() は CSS の値なので、色は表示属性ではなく style で渡す
const BEFORE = 'var(--text-muted)'
const DOT_RADIUS = 0.8
/** 焦点の weight が 0 でも元と提案の位置が見えるようにする最小の半径（mm） */
const MIN_RADIUS = 1.5
const HEAD_LENGTH = 2.6
const HEAD_HALF = 1.2

interface GhostLayerProps {
  page: Page
  ghost: Page
  /** ページの大きさ（mm） */
  width: number
  height: number
}

const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y

/**
 * `ghost` が `page` から変えたものを重ねる。動いた焦点とフキダシは元の位置を灰の破線、
 * 提案の位置を青の破線で描いて矢印でつなぎ、増えたベクトルは青の破線の矢印で描く。
 * コマは id で突き合わせ、`page` に無いコマは描かない
 */
export const GhostLayer = memo(function GhostLayer(props: GhostLayerProps) {
  const { page, ghost, width, height } = props
  return (
    <g data-layer="ghost" pointerEvents="none">
      {ghost.panels.map((after) => {
        const before = page.panels.find((p) => p.id === after.id)
        if (!before) return null
        return (
          <PanelGhost key={after.id} before={before} after={after} width={width} height={height} />
        )
      })}
    </g>
  )
})

function PanelGhost({
  before,
  after,
  width,
  height,
}: {
  before: Panel
  after: Panel
  width: number
  height: number
}) {
  const toPage = (p: Point) => toPagePoint(before, width, height, p)
  const box = panelBox(before, width, height)
  return (
    <g data-ghost-panel-id={after.id}>
      {after.focusPoints.map((focus) => {
        const old = before.focusPoints.find((f) => f.id === focus.id)
        if (!old || samePoint(old.pos, focus.pos)) return null
        const r = Math.max(focusRadius(focus.weight), MIN_RADIUS)
        const from = toPage(old.pos)
        const to = toPage(focus.pos)
        return (
          <g key={focus.id} data-ghost-focus-id={focus.id}>
            <Marker center={from} r={r} color={BEFORE} data-ghost="before" />
            <Arrow from={from} to={to} color={GUIDE} />
            <Marker center={to} r={r} color={GUIDE} data-ghost="after" />
          </g>
        )
      })}
      {after.bubbles.map((bubble) => {
        const old = before.bubbles.find((b) => b.id === bubble.id)
        if (!old || samePoint(old.pos, bubble.pos)) return null
        return (
          <g key={bubble.id} data-ghost-bubble-id={bubble.id}>
            <path
              data-ghost="before"
              d={bodyPath(old.shape, bubbleGeometry(old, box))}
              {...dashed(BEFORE)}
            />
            <Arrow from={toPage(old.pos)} to={toPage(bubble.pos)} color={GUIDE} />
            <path
              data-ghost="after"
              d={bodyPath(bubble.shape, bubbleGeometry(bubble, box))}
              {...dashed(GUIDE)}
            />
          </g>
        )
      })}
      {after.vectors
        .filter((v) => !before.vectors.some((old) => old.id === v.id))
        .map((v) => (
          <g key={v.id} data-ghost-vector-id={v.id} data-ghost="after">
            <Arrow
              from={toPage(v.from)}
              to={toPage(v.to)}
              color={GUIDE}
              width={v.strength === 'strong' ? 2 : 1.5}
            />
          </g>
        ))}
    </g>
  )
}

const dashed = (color: string) =>
  ({
    fill: 'none',
    style: { stroke: color },
    strokeWidth: 1.5,
    strokeDasharray: '4 3',
    vectorEffect: 'non-scaling-stroke',
  }) as const

function Marker({
  center,
  r,
  color,
  ...rest
}: {
  center: { x: number; y: number }
  r: number
  color: string
  'data-ghost': string
}) {
  return (
    <g {...rest}>
      <circle cx={center.x} cy={center.y} r={r} {...dashed(color)} />
      <circle cx={center.x} cy={center.y} r={DOT_RADIUS} style={{ fill: color }} />
    </g>
  )
}

/** hints-layer の Arrow と同じく、矢じりはズームとずれないよう mm の多角形で描く */
function Arrow({
  from,
  to,
  color,
  width = 1,
}: {
  from: { x: number; y: number }
  to: { x: number; y: number }
  color: string
  width?: number
}) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return null
  const ux = dx / len
  const uy = dy / len
  const head = Math.min(HEAD_LENGTH, len)
  const bx = to.x - ux * head
  const by = to.y - uy * head
  const points = [
    `${to.x},${to.y}`,
    `${bx - uy * HEAD_HALF},${by + ux * HEAD_HALF}`,
    `${bx + uy * HEAD_HALF},${by - ux * HEAD_HALF}`,
  ].join(' ')
  return (
    <>
      <line
        x1={from.x}
        y1={from.y}
        x2={bx}
        y2={by}
        style={{ stroke: color }}
        strokeWidth={width}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
      <polygon points={points} style={{ fill: color }} />
    </>
  )
}
