import { m } from '@manga/i18n'
import type { Page, PageTurn, ReadingDirection } from '@manga/schema'
import { memo } from 'react'
import { panelBox } from './hit-test'
import { FONT_FAMILY } from './page-layer'

// 印はページの白地の上にだけ描くので、テーマで変えない固定色にする
const TURN_COLOR = '#c2410c'

/** 角を埋める三角の辺の長さ（mm） */
const EAR = 6
const LABEL_SIZE = 2.8

interface TurnLayerProps {
  page: Page
  turn: PageTurn
  direction: ReadingDirection
  /** ページの大きさ（mm） */
  width: number
  height: number
}

/**
 * めくりの印。めくりの直前のページでは `Panel.order` の最後のコマの、めくる側の下の角に「めくり」を、
 * 直後のページでは最初のコマの、読み始める側の上の角に「めくり後」を、角を埋める三角とラベルで描く。
 * めくる側は右綴じなら左、左綴じなら右。ポインタイベントは受けない
 */
export const TurnLayer = memo(function TurnLayer(props: TurnLayerProps) {
  const { page, turn, direction, width, height } = props
  const ordered = [...page.panels].sort((a, b) => a.order - b.order)
  const first = turn.after ? ordered[0] : undefined
  const last = turn.before ? ordered.at(-1) : undefined
  const rtl = direction === 'rtl'
  return (
    <g data-layer="turn" pointerEvents="none">
      {last && (
        <Mark
          kind="before"
          panelId={last.id}
          box={panelBox(last, width, height)}
          left={rtl}
          top={false}
          label={m.editor_canvas_turn_before()}
        />
      )}
      {first && (
        <Mark
          kind="after"
          panelId={first.id}
          box={panelBox(first, width, height)}
          left={!rtl}
          top
          label={m.editor_canvas_turn_after()}
        />
      )}
    </g>
  )
})

function Mark({
  kind,
  panelId,
  box,
  left,
  top,
  label,
}: {
  kind: 'before' | 'after'
  panelId: string
  box: { x: number; y: number; w: number; h: number }
  /** 印を置く角が左か */
  left: boolean
  /** 印を置く角が上か */
  top: boolean
  label: string
}) {
  const x = left ? box.x : box.x + box.w
  const y = top ? box.y : box.y + box.h
  // 角からコマの内側へ向かう向き
  const sx = left ? 1 : -1
  const sy = top ? 1 : -1
  const points = [`${x},${y}`, `${x + sx * EAR},${y}`, `${x},${y + sy * EAR}`].join(' ')
  return (
    <g data-turn={kind} data-turn-panel-id={panelId}>
      <polygon points={points} style={{ fill: TURN_COLOR }} fillOpacity={0.85} />
      <text
        x={x + sx * (EAR + 1)}
        y={y + sy * 0.8}
        style={{ fill: TURN_COLOR }}
        stroke="#fff"
        strokeWidth={0.6}
        paintOrder="stroke"
        fontFamily={FONT_FAMILY}
        fontSize={LABEL_SIZE}
        fontWeight="bold"
        textAnchor={left ? 'start' : 'end'}
        dominantBaseline={top ? 'hanging' : 'auto'}
      >
        {label}
      </text>
    </g>
  )
}
