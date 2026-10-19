import type { FocusKind, FocusPoint, ID, Page, Panel, Point, Vector } from '@manga/schema'
import { memo } from 'react'
import { focusRadius, shiftLinked, toPagePoint } from './hint-ops'
import { FONT_FAMILY, GUIDE } from './page-layer'
import type { Selection } from './types'
import type { HintDraft } from './use-hint-tool'

// var() は CSS の値なので、色は表示属性ではなく style で渡す
const FOCUS_COLORS: Record<FocusKind, string> = {
  face: 'var(--hint-face)',
  keyObject: 'var(--hint-object)',
  sfx: 'var(--hint-sfx)',
}
const VECTOR_COLOR = 'var(--hint-vector)'

const DOT_RADIUS = 0.8
const LABEL_SIZE = 2.4
/** 矢じりの長さと半幅（mm） */
const HEAD_LENGTH = 2.6
const HEAD_HALF = 1.2

interface HintsLayerProps {
  page: Page
  /** ページの大きさ（mm） */
  width: number
  height: number
  selection: Selection
  draft: HintDraft | null
  /** 焦点の右下にラベルを出すか。診断のラベルを重ねるときは切る */
  labels: boolean
}

/**
 * 焦点とベクトルを描く。焦点は種別で色分けした円で、半径は weight に比例し、中心に点、右下にラベルを置く。
 * ベクトルは緑の矢印で、strong は太く weak は細い。ドラッグ中の焦点は `draft` の位置に描き、
 * 繋がったベクトルの端も一緒に動かす。ドラッグで大きさを決めている焦点はその大きさで、作成中のベクトルは破線で描く。当たり判定は hint-ops で行うので
 * ポインタイベントは受けない
 */
export const HintsLayer = memo(function HintsLayer(props: HintsLayerProps) {
  const { page, width, height, selection, draft, labels } = props
  const selectedId =
    selection?.kind === 'focus' || selection?.kind === 'vector' ? selection.id : undefined
  return (
    <g data-layer="hints" pointerEvents="none">
      {page.panels.map((panel) => {
        const moving = draft?.kind === 'focus' ? movingFocus(panel, draft) : undefined
        const toPage = (p: Point) => toPagePoint(panel, width, height, p)
        return (
          <g key={panel.id} data-hints-panel-id={panel.id}>
            {panel.vectors.map((v) => {
              const ends = moving ? shiftLinked(v, moving.id, moving.dx, moving.dy) : v
              return (
                <VectorView
                  key={v.id}
                  vector={v}
                  from={toPage(ends.from)}
                  to={toPage(ends.to)}
                  selected={v.id === selectedId}
                />
              )
            })}
            {panel.focusPoints.map((f) => (
              <FocusView
                key={f.id}
                focus={f}
                center={toPage(moving?.id === f.id ? moving.pos : f.pos)}
                selected={f.id === selectedId}
                label={labels}
              />
            ))}
            {draft?.kind === 'place' && draft.panelId === panel.id && (
              <g data-draft="focus">
                <FocusView
                  focus={{
                    id: 'draft',
                    kind: draft.focusKind,
                    label: '',
                    pos: draft.pos,
                    weight: draft.weight,
                  }}
                  center={toPage(draft.pos)}
                  selected={false}
                  label={false}
                />
              </g>
            )}
            {draft?.kind === 'vector' && draft.panelId === panel.id && (
              <Arrow
                from={toPage(draft.from)}
                to={toPage(draft.to)}
                width={2}
                dashed
                data-draft="vector"
              />
            )}
          </g>
        )
      })}
    </g>
  )
})

function movingFocus(
  panel: Panel,
  draft: Extract<HintDraft, { kind: 'focus' }>,
): { id: ID; pos: Point; dx: number; dy: number } | undefined {
  const focus = panel.focusPoints.find((f) => f.id === draft.focusId)
  if (!focus) return undefined
  return {
    id: focus.id,
    pos: draft.pos,
    dx: draft.pos.x - focus.pos.x,
    dy: draft.pos.y - focus.pos.y,
  }
}

function FocusView({
  focus,
  center,
  selected,
  label,
}: {
  focus: FocusPoint
  center: { x: number; y: number }
  selected: boolean
  label: boolean
}) {
  const color = FOCUS_COLORS[focus.kind]
  const r = focusRadius(focus.weight)
  return (
    <g data-focus-id={focus.id} data-kind={focus.kind} data-selected={selected || undefined}>
      {r > 0 && (
        <circle
          cx={center.x}
          cy={center.y}
          r={r}
          style={{ fill: color, stroke: selected ? GUIDE : color }}
          fillOpacity={0.12}
          strokeWidth={selected ? 2.5 : 1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle
        cx={center.x}
        cy={center.y}
        r={DOT_RADIUS}
        style={{ fill: selected ? GUIDE : color }}
      />
      {label && focus.label !== '' && (
        <text
          x={center.x + DOT_RADIUS}
          y={center.y + DOT_RADIUS}
          style={{ fill: color }}
          stroke="#fff"
          strokeWidth={0.6}
          paintOrder="stroke"
          fontFamily={FONT_FAMILY}
          fontSize={LABEL_SIZE}
          dominantBaseline="hanging"
        >
          {focus.label}
        </text>
      )}
    </g>
  )
}

function VectorView({
  vector,
  from,
  to,
  selected,
}: {
  vector: Vector
  from: { x: number; y: number }
  to: { x: number; y: number }
  selected: boolean
}) {
  const width = vector.strength === 'strong' ? 2 : 1
  return (
    <g
      data-vector-id={vector.id}
      data-kind={vector.kind}
      data-strength={vector.strength}
      data-selected={selected || undefined}
    >
      {selected && (
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          style={{ stroke: GUIDE }}
          strokeOpacity={0.35}
          strokeWidth={width + 5}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <Arrow from={from} to={to} width={width} />
    </g>
  )
}

/**
 * from から to への矢印。stroke は画面 px で太さを揃えるため non-scaling にしているので、
 * marker では矢じりの大きさがズームとずれる。矢じりは mm の多角形で描く
 */
function Arrow({
  from,
  to,
  width,
  dashed = false,
  ...rest
}: {
  from: { x: number; y: number }
  to: { x: number; y: number }
  width: number
  dashed?: boolean
  'data-draft'?: string
}) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return null
  const ux = dx / len
  const uy = dy / len
  const head = Math.min(HEAD_LENGTH, len)
  const half = HEAD_HALF * (width >= 2 ? 1 : 0.75)
  const bx = to.x - ux * head
  const by = to.y - uy * head
  const points = [
    `${to.x},${to.y}`,
    `${bx - uy * half},${by + ux * half}`,
    `${bx + uy * half},${by - ux * half}`,
  ].join(' ')
  return (
    <g {...rest}>
      <line
        x1={from.x}
        y1={from.y}
        x2={bx}
        y2={by}
        style={{ stroke: VECTOR_COLOR }}
        strokeWidth={width}
        strokeDasharray={dashed ? '4 2' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      <polygon points={points} style={{ fill: VECTOR_COLOR }} />
    </g>
  )
}
