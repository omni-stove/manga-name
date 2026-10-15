import type {
  DiagnosisConfig,
  FocusDiagnosis,
  Issue,
  Page,
  PageDiagnosis,
  Panel,
  PanelDiagnosis,
  Point,
  ProjectSettings,
  ReadingDirection,
} from '@manga/schema'
import { type Focus, panelFoci } from './focus'
import { panelDistance, toPage } from './geometry'
import { panelHint } from './hint'
import { inferReadingOrder } from './reading-order'
import { projectOntoSweep, sweepPath } from './sweep'

/** `ProjectSettings.diagnosis` で省略された項目に使う値 */
export const defaultDiagnosisConfig: DiagnosisConfig = Object.freeze({
  pathBand: 0.4,
  requireStrongForOk: false,
})

/** targetFocusId の無い Vector の終点を焦点に吸着させる距離（コマ高さ比） */
const VECTOR_SNAP = 0.1

/** Panel の矩形がこれ以上重なると OVERLAP */
const OVERLAP_MIN = 0.01

/** 距離や重なりは 2 進小数で丸まるので、閾値ちょうどの値を仕様どおり閾値側に入れる余裕 */
const EPSILON = 1e-9

type Counts = { strong: number; weak: number }

const resolveConfig = (settings: ProjectSettings): DiagnosisConfig => ({
  pathBand: settings.diagnosis?.pathBand ?? defaultDiagnosisConfig.pathBand,
  requireStrongForOk:
    settings.diagnosis?.requireStrongForOk ?? defaultDiagnosisConfig.requireStrongForOk,
})

const byOrder = <T extends { order: number }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.order - b.order)

/** 終点から VECTOR_SNAP 以内で最も近い焦点の id */
const nearestFocusId = (panel: Panel, foci: readonly Focus[], to: Point): string | undefined => {
  let best: string | undefined
  let bestDistance = VECTOR_SNAP + EPSILON
  for (const f of foci) {
    const d = panelDistance(panel, f.pos, to)
    if (d <= bestDistance) {
      best = f.id
      bestDistance = d
    }
  }
  return best
}

/** 焦点ごとの誘導線の本数（04 の 4 節）。フキダシは bubble chain の分として strong を 1 本持つ */
const countVectors = (panel: Panel, foci: readonly Focus[]): Map<string, Counts> => {
  const counts = new Map<string, Counts>(
    foci.map((f) => [f.id, { strong: f.kind === 'bubble' ? 1 : 0, weak: 0 }]),
  )
  for (const v of panel.vectors) {
    const target = v.targetFocusId ?? nearestFocusId(panel, foci, v.to)
    const c = target === undefined ? undefined : counts.get(target)
    if (c) c[v.strength] += 1
  }
  return counts
}

/** 焦点のステータスと、ok 以外または経路外のときの短い説明（04 の 5 節） */
const judge = (
  distance: number,
  { strong, weak }: Counts,
  config: DiagnosisConfig,
): Pick<FocusDiagnosis, 'status' | 'reason'> => {
  const off = distance.toFixed(2)
  if (distance <= config.pathBand + EPSILON) {
    return config.requireStrongForOk && strong === 0
      ? { status: 'weak', reason: '経路上にあるが強い誘導線がない' }
      : { status: 'ok' }
  }
  if (strong >= 1) return { status: 'ok', reason: `経路から ${off} 外れているが強い誘導線がある` }
  if (weak >= 1) return { status: 'weak', reason: `経路から ${off} 外れており弱い誘導線しかない` }
  return { status: 'miss', reason: `経路から ${off} 外れており誘導線がない` }
}

const diagnosePanel = (
  panel: Panel,
  direction: ReadingDirection,
  config: DiagnosisConfig,
  issues: Issue[],
): PanelDiagnosis => {
  const foci = panelFoci(panel)
  const counts = countVectors(panel, foci)

  if (panel.focusPoints.length === 0 && panel.bubbles.length === 0 && !panel.note?.trim()) {
    issues.push({
      severity: 'info',
      code: 'EMPTY_PANEL',
      panelId: panel.id,
      message: '焦点もフキダシもメモもない',
    })
  }

  const focus = foci.map((f): FocusDiagnosis => {
    const { t, distance } = projectOntoSweep(panel, f.pos, direction)
    const c = counts.get(f.id) ?? { strong: 0, weak: 0 }
    const { status, reason } = judge(distance, c, config)
    if (status !== 'ok') {
      issues.push({
        severity: status === 'miss' ? 'warning' : 'info',
        code: status === 'miss' ? 'FOCUS_MISS' : 'FOCUS_WEAK',
        panelId: panel.id,
        focusPointId: f.id,
        message: `${f.label}: ${reason}`,
      })
    }
    return {
      focusPointId: f.id,
      kind: f.kind,
      panelId: panel.id,
      t,
      distance,
      strong: c.strong,
      weak: c.weak,
      status,
      ...(reason === undefined ? {} : { reason }),
    }
  })

  // panelFoci は Bubble を order 順に並べるので、合成焦点の並びがそのまま order 順
  const bubbleTs = focus.filter((f) => f.kind === 'bubble').map((f) => f.t)
  const bubbleOrderOk = bubbleTs.every((t, i) => i === 0 || t >= (bubbleTs[i - 1] ?? t))
  if (!bubbleOrderOk) {
    issues.push({
      severity: 'warning',
      code: 'BUBBLE_ORDER',
      panelId: panel.id,
      message: 'フキダシの順が視線経路の向きと逆転している',
    })
  }

  const diagnosis: PanelDiagnosis = {
    panelId: panel.id,
    sweepPath: sweepPath(panel, direction),
    focus,
    bubbleOrderOk,
    hint: '',
  }
  return { ...diagnosis, hint: panelHint(panel, diagnosis) }
}

const overlapIssues = (panels: readonly Panel[]): Issue[] => {
  const issues: Issue[] = []
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i]
      const b = panels[j]
      if (!a || !b) continue
      const w = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x)
      const h = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y)
      if (w >= OVERLAP_MIN - EPSILON && h >= OVERLAP_MIN - EPSILON) {
        issues.push({
          severity: 'error',
          code: 'OVERLAP',
          panelId: a.id,
          message: `${a.id} と ${b.id} の矩形が重なっている`,
        })
      }
    }
  }
  return issues
}

/**
 * ページ内の全 Bubble を Panel.order、Bubble.order の順に並べた、ページ座標の点列（04 の 7 節）。
 * Bubble が無ければ空配列。
 */
export function bubbleChain(page: Page): Point[] {
  return byOrder(page.panels).flatMap((panel) =>
    byOrder(panel.bubbles).map((b) => toPage(panel, b.pos)),
  )
}

/**
 * ページを診断する（`docs/04-diagnosis-spec.md`）。Bubble を合成焦点に加えてから、
 * 読み順、焦点の t・距離・誘導線・ステータス、フキダシ順、bubble chain、Issue、集計、ヒントを返す。
 * panels と issues は Panel.order 順。純粋関数で、入力は変更しない。
 */
export function diagnosePage(page: Page, settings: ProjectSettings): PageDiagnosis {
  const config = resolveConfig(settings)
  const panels = byOrder(page.panels)
  const issues: Issue[] = []

  const inferredOrder = inferReadingOrder(page.panels, settings.direction)
  const readingOrderOk =
    inferredOrder.length === panels.length && inferredOrder.every((id, i) => panels[i]?.id === id)
  if (!readingOrderOk) {
    issues.push({
      severity: 'warning',
      code: 'READING_ORDER',
      message: `配置から推定した読み順は ${inferredOrder.join(' → ')}`,
    })
  }
  issues.push(...overlapIssues(panels))

  const panelDiagnoses = panels.map((p) => diagnosePanel(p, settings.direction, config, issues))

  const summary = { total: 0, ok: 0, weak: 0, miss: 0 }
  for (const p of panelDiagnoses) {
    for (const f of p.focus) {
      summary.total += 1
      summary[f.status] += 1
    }
  }

  return {
    pageId: page.id,
    readingOrderOk,
    inferredOrder,
    panels: panelDiagnoses,
    bubbleChain: bubbleChain(page),
    summary,
    issues,
  }
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { fixtures, PageDiagnosisSchema } = await import('@manga/schema')

  const project = fixtures.samplePage01
  const settings = project.settings
  const samplePage = (): Page => {
    const page = project.episodes[0]?.pages[0]
    if (!page) throw new Error('fixture has no page')
    return structuredClone(page)
  }

  const findPanel = (page: Page, id: string): Panel => {
    const panel = page.panels.find((p) => p.id === id)
    if (!panel) throw new Error(`no panel ${id}`)
    return panel
  }

  const findFocus = (d: PageDiagnosis, id: string): FocusDiagnosis => {
    const f = d.panels.flatMap((p) => p.focus).find((x) => x.focusPointId === id)
    if (!f) throw new Error(`no focus ${id}`)
    return f
  }

  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === 'object') {
      for (const v of Object.values(value)) deepFreeze(v)
      Object.freeze(value)
    }
    return value
  }

  /** 浮動小数の末尾の揺れを除いて比べるため、数値を 1e-6 に丸め、undefined のキーを落とす */
  const normalise = (value: unknown): unknown =>
    JSON.parse(JSON.stringify(value), (_, v) =>
      typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v,
    )

  describe('sample-page-01 expectations (04 の期待値表)', () => {
    const d = diagnosePage(samplePage(), settings)

    test.each<[string, number]>([
      ['fp_1_forest', 0.35],
      ['fp_1_e', 0.7],
      ['bb_1', 0.08],
      ['fp_2_e', 0.25],
      ['fp_2_vial', 0.55],
      ['bb_3', 0.15],
      ['fp_3_e', 0.55],
      ['fp_4_mask', 0.55],
      ['fp_4_e', 0.18],
      ['fp_5_e', 0.38],
      ['bb_6', 0.15],
      ['fp_6_sprouts', 0.6],
    ])('%s: t ≈ %s and ok', (id, t) => {
      const f = findFocus(d, id)
      expect(Math.abs(f.t - t)).toBeLessThanOrEqual(0.02)
      expect(f.status).toBe('ok')
    })

    test('reading order, bubble order and summary', () => {
      expect(d.readingOrderOk).toBe(true)
      expect(d.inferredOrder).toEqual(['pn_1', 'pn_2', 'pn_3', 'pn_4', 'pn_5', 'pn_6'])
      expect(d.panels.every((p) => p.bubbleOrderOk)).toBe(true)
      expect(d.summary).toEqual({ total: 12, ok: 12, weak: 0, miss: 0 })
      expect(d.issues).toEqual([])
    })

    test('bubbles are synthetic foci with one strong vector', () => {
      const bubble = findFocus(d, 'bb_1')
      expect(bubble.kind).toBe('bubble')
      expect(bubble.strong).toBe(1)
      expect(findFocus(d, 'fp_1_e')).toMatchObject({ strong: 1, weak: 1 })
    })

    test('Panel 4 hint names the mask before E crouched and says 大きく', () => {
      const hint = d.panels.find((p) => p.panelId === 'pn_4')?.hint ?? ''
      const mask = hint.indexOf('beast porcelain mask')
      const crouched = hint.indexOf('E crouched, still')
      expect(mask).toBeGreaterThanOrEqual(0)
      expect(crouched).toBeGreaterThan(mask)
      expect(hint).toContain('大きく')
      expect(hint).not.toMatch(/\n/)
    })

    test('bubble chain follows panel order in page coordinates', () => {
      expect(d.bubbleChain).toHaveLength(3)
      expect(d.bubbleChain[0]?.x).toBeCloseTo(0.92)
      expect(d.bubbleChain[0]?.y).toBeCloseTo(0.0572)
      expect(d.bubbleChain[2]?.y).toBeCloseTo(0.8845)
    })

    test('matches docs/fixtures/sample-page-01.diagnosis.json', async () => {
      const { default: snapshot } = await import(
        '../../../docs/fixtures/sample-page-01.diagnosis.json'
      )
      expect(PageDiagnosisSchema.parse(d)).toBeTruthy()
      expect(normalise(d)).toEqual(normalise(snapshot.diagnosis))
    })
  })

  test('E crouched moved to y = 0.95 becomes miss', () => {
    const page = samplePage()
    const e = findPanel(page, 'pn_4').focusPoints.find((f) => f.id === 'fp_4_e')
    if (!e) throw new Error('no fp_4_e')
    e.pos = { ...e.pos, y: 0.95 }
    const d = diagnosePage(page, settings)
    expect(findFocus(d, 'fp_4_e').status).toBe('miss')
    expect(d.summary.miss).toBe(1)
    expect(d.issues).toContainEqual(
      expect.objectContaining({ code: 'FOCUS_MISS', severity: 'warning', focusPointId: 'fp_4_e' }),
    )
    const hint = d.panels.find((p) => p.panelId === 'pn_4')?.hint ?? ''
    expect(hint).not.toContain('E crouched')
  })

  test('swapping the order of Panel 2 and 3 reports READING_ORDER', () => {
    const page = samplePage()
    findPanel(page, 'pn_2').order = 3
    findPanel(page, 'pn_3').order = 2
    const d = diagnosePage(page, settings)
    expect(d.readingOrderOk).toBe(false)
    expect(d.issues.filter((i) => i.code === 'READING_ORDER')).toHaveLength(1)
  })

  test('ltr flips t', () => {
    const d = diagnosePage(samplePage(), { ...settings, direction: 'ltr' })
    expect(findFocus(d, 'fp_1_forest').t).toBeCloseTo(0.65)
  })

  test('polyline sweep projects foci onto the polyline', () => {
    const page = samplePage()
    findPanel(page, 'pn_5').sweep = {
      kind: 'polyline',
      points: [
        { x: 0.62, y: 0 },
        { x: 0.62, y: 1 },
      ],
    }
    const f = findFocus(diagnosePage(page, settings), 'fp_5_e')
    expect(f.t).toBeCloseTo(0.5)
    expect(f.distance).toBeCloseTo(0)
  })

  test('works on deeply frozen input', () => {
    const page = deepFreeze(samplePage())
    const frozenSettings = deepFreeze(structuredClone(settings))
    expect(normalise(diagnosePage(page, frozenSettings))).toEqual(
      normalise(diagnosePage(samplePage(), settings)),
    )
  })

  test('vectors without a target snap to a focus within 0.1 of the end', () => {
    const page = samplePage()
    const panel = findPanel(page, 'pn_4')
    panel.vectors = [
      { id: 'v1', kind: 'speed', from: { x: 0, y: 0 }, to: { x: 0.81, y: 0.87 }, strength: 'weak' },
      { id: 'v2', kind: 'speed', from: { x: 0, y: 0 }, to: { x: 0.1, y: 0.1 }, strength: 'strong' },
    ]
    const d = diagnosePage(page, settings)
    expect(findFocus(d, 'fp_4_e')).toMatchObject({ strong: 0, weak: 1 })
    expect(findFocus(d, 'fp_4_mask')).toMatchObject({ strong: 0, weak: 0 })
  })

  test('off-path foci: strong keeps ok, weak only gives FOCUS_WEAK', () => {
    const page = samplePage()
    const panel = findPanel(page, 'pn_4')
    const e = panel.focusPoints.find((f) => f.id === 'fp_4_e')
    if (!e) throw new Error('no fp_4_e')
    e.pos = { ...e.pos, y: 0.95 }
    const vector = {
      id: 'v',
      kind: 'gaze' as const,
      from: { x: 0.45, y: 0.3 },
      to: { x: 0.8, y: 0.9 },
      targetFocusId: 'fp_4_e',
    }

    panel.vectors = [{ ...vector, strength: 'strong' }]
    const strong = findFocus(diagnosePage(page, settings), 'fp_4_e')
    expect(strong.status).toBe('ok')
    expect(strong.reason).toContain('0.45')

    panel.vectors = [{ ...vector, strength: 'weak' }]
    const d = diagnosePage(page, settings)
    expect(findFocus(d, 'fp_4_e').status).toBe('weak')
    expect(d.issues).toContainEqual(
      expect.objectContaining({ code: 'FOCUS_WEAK', severity: 'info', focusPointId: 'fp_4_e' }),
    )
  })

  test('requireStrongForOk turns on-path foci without strong vectors into weak', () => {
    const d = diagnosePage(samplePage(), {
      ...settings,
      diagnosis: { requireStrongForOk: true },
    })
    expect(findFocus(d, 'fp_5_e').status).toBe('weak')
    expect(findFocus(d, 'fp_4_mask').status).toBe('ok')
    expect(findFocus(d, 'bb_1').status).toBe('ok')
  })

  test('reversed bubbles report BUBBLE_ORDER', () => {
    const page = samplePage()
    const panel = findPanel(page, 'pn_6')
    const first = panel.bubbles[0]
    if (!first) throw new Error('no bubble')
    panel.bubbles = [first, { ...first, id: 'bb_6b', order: 2, pos: { x: 0.95, y: 0.3 } }]
    const d = diagnosePage(page, settings)
    expect(d.panels.find((p) => p.panelId === 'pn_6')?.bubbleOrderOk).toBe(false)
    expect(d.issues.map((i) => i.code)).toContain('BUBBLE_ORDER')
  })

  test('empty and overlapping panels', () => {
    const page = samplePage()
    const panel = findPanel(page, 'pn_5')
    panel.focusPoints = []
    panel.vectors = []
    panel.note = ' '
    findPanel(page, 'pn_6').rect = { x: 0, y: 0.835, w: 0.51, h: 0.165 }
    const d = diagnosePage(page, settings)
    expect(d.issues).toContainEqual(
      expect.objectContaining({ code: 'EMPTY_PANEL', severity: 'info', panelId: 'pn_5' }),
    )
    expect(d.issues).toContainEqual(expect.objectContaining({ code: 'OVERLAP', severity: 'error' }))
  })

  test('a page without bubbles has an empty bubble chain', () => {
    const page = samplePage()
    for (const p of page.panels) p.bubbles = []
    expect(bubbleChain(page)).toEqual([])
  })

  test('30 panels with 20 foci each diagnose within 5ms', () => {
    const template = findPanel(samplePage(), 'pn_1')
    const panels: Panel[] = Array.from({ length: 30 }, (_, i) => {
      const col = i % 5
      const row = Math.floor(i / 5)
      const id = `pn_${i}`
      return {
        ...template,
        id,
        order: i + 1,
        rect: { x: 0.8 - col * 0.2, y: row / 6, w: 0.18, h: 0.15 },
        focusPoints: Array.from({ length: 15 }, (_, k) => ({
          id: `${id}_fp_${k}`,
          kind: 'face' as const,
          label: `focus ${k}`,
          pos: { x: (k * 0.37) % 1, y: (k * 0.53) % 1 },
          weight: (k % 10) / 10,
        })),
        bubbles: Array.from({ length: 5 }, (_, k) => ({
          id: `${id}_bb_${k}`,
          order: k + 1,
          text: '……',
          shape: 'normal' as const,
          pos: { x: 1 - k * 0.2, y: 0.2 },
          size: { w: 0.1, h: 0.2 },
        })),
        vectors: Array.from({ length: 20 }, (_, k) => ({
          id: `${id}_vc_${k}`,
          kind: 'gaze' as const,
          from: { x: 0, y: 0 },
          to: { x: (k * 0.37) % 1, y: (k * 0.53) % 1 },
          strength: k % 2 === 0 ? ('strong' as const) : ('weak' as const),
          ...(k % 3 === 0 ? {} : { targetFocusId: `${id}_fp_${k % 15}` }),
        })),
      }
    })
    const page: Page = { ...samplePage(), panels }

    for (let i = 0; i < 20; i++) diagnosePage(page, settings)
    const runs = 100
    const start = performance.now()
    for (let i = 0; i < runs; i++) diagnosePage(page, settings)
    const average = (performance.now() - start) / runs

    expect(diagnosePage(page, settings).summary.total).toBe(600)
    expect(average).toBeLessThan(5)
  })
}
