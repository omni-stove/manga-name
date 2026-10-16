import type { Panel, PanelDiagnosis, Point } from '@manga/schema'
import { type Focus, panelFoci } from './focus'

/** この weight 以上の焦点はヒントで「大きく」捉える */
const LARGE_WEIGHT = 0.5

/** 3x3 の格子の名前。[行][列]、行は上から、列は左から */
const GRID = [
  ['左上', '中央上', '右上'],
  ['左', '中央', '右'],
  ['左下', '中央下', '右下'],
] as const

/** コマ内座標を 0, 0.5, 1 に丸めた 3x3 の格子の名前 */
const gridName = (pos: Point): string => {
  const cell = (v: number) => Math.min(2, Math.max(0, Math.round(v * 2)))
  return GRID[cell(pos.y)]?.[cell(pos.x)] ?? '中央'
}

type HintFocus = { phrase: string; large: boolean }

/**
 * Panel の生成ヒントを 1 文で返す（04 の 10 節）。生成プロンプトにそのまま連結する前提で、改行を含まない。
 * weight 0.5 以上の焦点は「<位置>の <label> を大きく捉え」として先に置き、残りを t の昇順で
 * 「<位置>の <label> から … へ流れる」とつなぐ（04 の Panel 4 の期待値どおり、大きい焦点は t によらず先頭）。
 * 焦点が 1 つなら「… に集まる」。位置は `pos` を 0, 0.5, 1 に丸めた 3x3 の格子の名前。
 * `miss` の焦点と、`panel` に見つからない焦点は含めない。焦点が無ければ空文字。
 */
export function panelHint(panel: Panel, diagnosis: PanelDiagnosis): string {
  const sources = new Map<string, Focus>(panelFoci(panel).map((f) => [f.id, f]))

  const foci: HintFocus[] = diagnosis.focus
    .filter((f) => f.status !== 'miss')
    .sort((a, b) => a.t - b.t)
    .flatMap((f) => {
      const source = sources.get(f.focusPointId)
      if (!source) return []
      // label 由来の改行がプロンプトの行を割らないよう空白に寄せる
      const label = source.label.replace(/\s+/g, ' ').trim()
      return [
        { phrase: `${gridName(source.pos)}の ${label}`, large: source.weight >= LARGE_WEIGHT },
      ]
    })

  const large = foci.filter((f) => f.large).map((f) => f.phrase)
  const flow = foci.filter((f) => !f.large).map((f) => f.phrase)
  if (large.length === 0 && flow.length === 0) return ''

  const anchor = large.join(' と ')
  const first = flow[0]
  const last = flow.at(-1)
  if (!first || !last) return `視線は${anchor} に大きく集まる`

  const via = flow.slice(1, -1)
  const path =
    flow.length === 1
      ? `${first} `
      : `${first} から${via.length > 0 ? `${via.join(' と ')} を経て` : ''}${last} `
  const ending = flow.length === 1 && large.length === 0 ? 'に集まる' : 'へ流れる'
  return `視線は${large.length > 0 ? `${anchor} を大きく捉え、` : ''}${path}${ending}`
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  const panel = {
    id: 'pn',
    order: 1,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    bubbles: [
      {
        id: 'bb',
        order: 1,
        text: '',
        shape: 'normal',
        pos: { x: 0.9, y: 0.1 },
        size: { w: 0.1, h: 0.1 },
      },
    ],
    arts: [],
    focusPoints: [
      { id: 'big', kind: 'face', label: 'big face', pos: { x: 0.5, y: 0.5 }, weight: 0.8 },
      { id: 'a', kind: 'face', label: 'a', pos: { x: 0.5, y: 0.9 }, weight: 0.2 },
      { id: 'b', kind: 'keyObject', label: 'b\nline', pos: { x: 0.1, y: 0.9 }, weight: 0.2 },
    ],
    vectors: [],
  } satisfies Panel

  const focus = (focusPointId: string, t: number, status: 'ok' | 'weak' | 'miss' = 'ok') => ({
    focusPointId,
    kind: 'face' as const,
    panelId: 'pn',
    t,
    distance: 0,
    strong: 0,
    weak: 0,
    status,
  })

  const diagnosis = (f: PanelDiagnosis['focus']): PanelDiagnosis => ({
    panelId: 'pn',
    sweepPath: [],
    focus: f,
    bubbleOrderOk: true,
    hint: '',
  })

  test('flows through foci in t order with the large one first', () => {
    const hint = panelHint(
      panel,
      diagnosis([focus('b', 0.9), focus('big', 0.5), focus('a', 0.5), focus('bb', 0.1)]),
    )
    expect(hint).toBe(
      '視線は中央の big face を大きく捉え、右上の フキダシ から中央下の a を経て左下の b line へ流れる',
    )
    expect(hint).not.toMatch(/\n/)
  })

  test('a single focus gathers the gaze; miss foci are left out', () => {
    expect(panelHint(panel, diagnosis([focus('a', 0.5), focus('b', 0.9, 'miss')]))).toBe(
      '視線は中央下の a に集まる',
    )
    expect(panelHint(panel, diagnosis([focus('big', 0.5)]))).toBe(
      '視線は中央の big face に大きく集まる',
    )
  })

  test('no foci gives an empty hint', () => {
    expect(panelHint(panel, diagnosis([]))).toBe('')
    expect(panelHint(panel, diagnosis([focus('a', 0.5, 'miss')]))).toBe('')
  })
}
