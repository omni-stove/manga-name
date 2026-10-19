import { m } from '@manga/i18n'
import type { FocusDiagnosis, FocusStatus, ID, Page, PageDiagnosis, Point } from '@manga/schema'
import { memo } from 'react'
import { toPagePoint } from './hint-ops'
import { panelBox } from './hit-test'
import { FONT_FAMILY } from './page-layer'

// 診断はページの白地の上にだけ描くので、テーマで変えない固定色にする
const SWEEP_COLOR = '#8a8f98'
const CHAIN_COLOR = '#d6339a'
const CHAIN_GUIDE_COLOR = '#f2a7cf'
// var() は CSS の値なので、色は表示属性ではなく style で渡す
const STATUS_COLORS: Record<FocusStatus, string> = {
  ok: 'var(--hint-vector)',
  weak: 'var(--hint-object)',
  miss: 'var(--alert)',
}

const DOT_RADIUS = 0.8
const LABEL_SIZE = 2.4
const SUMMARY_SIZE = 3.2
/** ページ下端から集計行と凡例までの間（mm）。fitView の余白に収まる */
const SUMMARY_GAP = 2
const LEGEND_GAP = 6.5
const LEGEND_SWATCH = 6

/** 集計行。例 `reading order OK | focus points: 12 ok 12 miss 0`。weak は 1 件以上のときだけ出す */
function summaryLine(diagnosis: PageDiagnosis): string {
  const { total, ok, weak, miss } = diagnosis.summary
  const order = diagnosis.readingOrderOk ? 'OK' : 'NG'
  const weakPart = weak > 0 ? ` weak ${weak}` : ''
  return `reading order ${order} | focus points: ${total} ok ${ok}${weakPart} miss ${miss}`
}

/** 焦点ラベルの診断。`<label> <S>S/<W>W t<t> <status>` */
function focusLabel(label: string, focus: FocusDiagnosis): string {
  const head = label === '' ? '' : `${label} `
  return `${head}${focus.strong}S/${focus.weak}W t${focus.t.toFixed(2)} ${focus.status}`
}

interface DiagnosisLayerProps {
  page: Page
  diagnosis: PageDiagnosis
  /** ページの大きさ（mm） */
  width: number
  height: number
}

/**
 * 視線誘導診断のオーバーレイ。centre sweep はコマ内の水平線とコマ間の斜線を灰色破線で、
 * bubble chain はマゼンタの太線で描き、各フキダシに縦横の薄いピンク破線を引く。
 * 焦点（フキダシの合成焦点を含む）には診断つきのラベルを status の色で付け、
 * ページの下に集計行と凡例を置く。ポインタイベントは受けない
 */
export const DiagnosisLayer = memo(function DiagnosisLayer(props: DiagnosisLayerProps) {
  const { page, diagnosis, width, height } = props
  const toPage = (p: Point) => ({ x: p.x * width, y: p.y * height })
  const byPanel = new Map(diagnosis.panels.map((d) => [d.panelId, d]))
  const sweeps = [...page.panels]
    .sort((a, b) => a.order - b.order)
    .flatMap((panel) => {
      const d = byPanel.get(panel.id)
      return d && d.sweepPath.length > 0
        ? [{ panelId: panel.id, path: d.sweepPath.map(toPage) }]
        : []
    })
  const links = sweeps.slice(1).map((next, i) => {
    const prev = sweeps[i] as (typeof sweeps)[number]
    return { id: `${prev.panelId}-${next.panelId}`, from: prev.path.at(-1), to: next.path[0] }
  })
  const chain = diagnosis.bubbleChain.map(toPage)
  const labels = focusAnchors(page, width, height)

  return (
    <g data-layer="diagnosis" pointerEvents="none">
      <g data-diagnosis="sweep" style={{ stroke: SWEEP_COLOR }} fill="none">
        {sweeps.map((s) => (
          <polyline
            key={s.panelId}
            data-sweep-panel-id={s.panelId}
            points={s.path.map((p) => `${p.x},${p.y}`).join(' ')}
            strokeWidth={1.5}
            strokeDasharray="5 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {links.map(
          (l) =>
            l.from &&
            l.to && (
              <line
                key={l.id}
                data-sweep-link={l.id}
                x1={l.from.x}
                y1={l.from.y}
                x2={l.to.x}
                y2={l.to.y}
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            ),
        )}
      </g>
      <g data-diagnosis="bubble-chain" fill="none">
        {page.panels.flatMap((panel) => {
          const box = panelBox(panel, width, height)
          return panel.bubbles.map((bubble) => {
            const c = toPagePoint(panel, width, height, bubble.pos)
            return (
              <g key={bubble.id} style={{ stroke: CHAIN_GUIDE_COLOR }}>
                <line
                  x1={box.x}
                  y1={c.y}
                  x2={box.x + box.w}
                  y2={c.y}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={c.x}
                  y1={box.y}
                  x2={c.x}
                  y2={box.y + box.h}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })
        })}
        {chain.length > 1 && (
          <polyline
            points={chain.map((p) => `${p.x},${p.y}`).join(' ')}
            style={{ stroke: CHAIN_COLOR }}
            strokeWidth={4}
            strokeOpacity={0.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>
      <g data-diagnosis="focus">
        {diagnosis.panels.flatMap((d) =>
          d.focus.map((f) => {
            const anchor = labels.get(f.focusPointId)
            if (!anchor) return null
            return (
              <text
                key={f.focusPointId}
                data-diagnosis-focus-id={f.focusPointId}
                data-status={f.status}
                x={anchor.x + DOT_RADIUS}
                y={anchor.y + DOT_RADIUS}
                style={{ fill: STATUS_COLORS[f.status] }}
                stroke="#fff"
                strokeWidth={0.6}
                paintOrder="stroke"
                fontFamily={FONT_FAMILY}
                fontSize={LABEL_SIZE}
                dominantBaseline="hanging"
              >
                {focusLabel(anchor.label, f)}
              </text>
            )
          }),
        )}
      </g>
      <text
        data-diagnosis="summary"
        x={0}
        y={height + SUMMARY_GAP}
        style={{
          fill:
            diagnosis.summary.miss > 0 || !diagnosis.readingOrderOk
              ? 'var(--alert)'
              : 'var(--text)',
        }}
        fontFamily={FONT_FAMILY}
        fontSize={SUMMARY_SIZE}
        dominantBaseline="hanging"
      >
        {summaryLine(diagnosis)}
      </text>
      <Legend y={height + LEGEND_GAP} />
    </g>
  )
})

/** 焦点とフキダシの id から、ラベルを付ける位置（mm）と名前 */
function focusAnchors(
  page: Page,
  width: number,
  height: number,
): Map<ID, { x: number; y: number; label: string }> {
  const anchors = new Map<ID, { x: number; y: number; label: string }>()
  for (const panel of page.panels) {
    for (const f of panel.focusPoints) {
      anchors.set(f.id, { ...toPagePoint(panel, width, height, f.pos), label: f.label })
    }
    for (const b of panel.bubbles) {
      anchors.set(b.id, {
        ...toPagePoint(panel, width, height, b.pos),
        label: m.bubble(),
      })
    }
  }
  return anchors
}

const LEGEND: readonly {
  key: string
  label: () => string
  stroke: string
  dash?: string
  width: number
}[] = [
  {
    key: 'sweep',
    label: m.editor_canvas_diagnosis_legend_sweep,
    stroke: SWEEP_COLOR,
    dash: '5 3',
    width: 1.5,
  },
  { key: 'chain', label: m.editor_canvas_diagnosis_legend_chain, stroke: CHAIN_COLOR, width: 4 },
  {
    key: 'vector',
    label: m.editor_canvas_diagnosis_legend_vector,
    stroke: 'var(--hint-vector)',
    width: 2,
  },
]

const LEGEND_STATUS: readonly FocusStatus[] = ['ok', 'weak', 'miss']

function legendStarts(labels: readonly string[]): number[] {
  let x = 0
  return labels.map((label) => {
    const at = x
    x += LEGEND_SWATCH + 1 + label.length * LABEL_SIZE * 0.9 + 3
    return at
  })
}

function Legend({ y }: { y: number }) {
  const labels = LEGEND.map((l) => l.label())
  const starts = legendStarts([...labels, ...LEGEND_STATUS])
  return (
    <g data-diagnosis="legend" fontFamily={FONT_FAMILY} fontSize={LABEL_SIZE}>
      {LEGEND.map((l, i) => {
        const label = labels[i] as string
        const at = starts[i] as number
        return (
          <g key={l.key}>
            <line
              x1={at}
              y1={y + LABEL_SIZE / 2}
              x2={at + LEGEND_SWATCH}
              y2={y + LABEL_SIZE / 2}
              style={{ stroke: l.stroke }}
              strokeWidth={l.width}
              strokeDasharray={l.dash}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={at + LEGEND_SWATCH + 1}
              y={y}
              style={{ fill: 'var(--text-muted)' }}
              dominantBaseline="hanging"
            >
              {label}
            </text>
          </g>
        )
      })}
      {LEGEND_STATUS.map((s, i) => {
        const at = starts[LEGEND.length + i] as number
        return (
          <text
            key={s}
            x={at}
            y={y}
            style={{ fill: STATUS_COLORS[s] }}
            fontWeight="bold"
            dominantBaseline="hanging"
          >
            {s}
          </text>
        )
      })}
    </g>
  )
}
