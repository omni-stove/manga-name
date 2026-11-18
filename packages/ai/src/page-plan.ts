import {
  type Bubble,
  type Character,
  createBubble,
  createPage,
  fitBubble,
  type LayoutTemplate,
  type Page,
  type PagePlan,
  type PageTemplate,
  type Panel,
  type PlanLine,
  type Project,
} from '@manga/schema'
import type { PagePlanRequest } from './provider'

/** ページ割りに渡す脚本、ページ数、トーン */
export interface ScriptDraftInput {
  script: string
  /** 脚本を割り振るページ数。省くと LLM に任せる */
  pageCount?: number
  /** トーンのヒント。空なら送らない */
  tone: string
}

/** ページ割りのページ数の上限。Workers の受け付けとプロンプトがこの値を使う */
export const MAX_PAGE_COUNT = 64

/** ページ数の入力を読む。空は undefined、1〜MAX_PAGE_COUNT の整数でなければ null */
export function parsePageCount(text: string): number | undefined | null {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  return Number.isInteger(n) && n >= 1 && n <= MAX_PAGE_COUNT ? n : null
}

const withTone = (tone: string, text: string) => {
  const t = tone.trim()
  return t === '' ? text : `（全体のトーン: ${t}）\n${text}`
}

/**
 * ページ割りの要求。PagePlanRequest にトーンの欄が無いので、トーンは脚本の頭に括弧書きで添える
 */
export function planRequest(project: Project, input: ScriptDraftInput): PagePlanRequest {
  return {
    project: { settings: project.settings, characters: project.characters },
    script: withTone(input.tone, input.script.trim()),
    ...(input.pageCount !== undefined && { pageCount: input.pageCount }),
  }
}

/**
 * プロジェクトに居ないキャラと重複を `cast` から落とし、居ない話し手を `speakerId` から落とす。
 * 流れ、脚本、セリフの前後の空白を落とし、空になったセリフは捨てる
 */
export function normalizePlan(plan: PagePlan, characters: readonly Character[]): PagePlan {
  const known = (id: string) => characters.some((c) => c.id === id)
  return {
    note: plan.note.trim(),
    script: plan.script.trim(),
    cast: plan.cast.filter((id, i) => plan.cast.indexOf(id) === i && known(id)),
    lines: plan.lines.flatMap(({ speakerId, ...line }) => {
      const text = line.text.trim()
      if (text === '') return []
      return [{ ...line, text, ...(speakerId !== undefined && known(speakerId) && { speakerId }) }]
    }),
  }
}

/** セリフを「名前「…」」の形で 1 行に書く。話し手が居なければ本文だけ */
function formatLine(line: PlanLine, characters: readonly Character[]): string {
  const speaker = characters.find((c) => c.id === line.speakerId)
  return speaker ? `${speaker.name}「${line.text}」` : line.text
}

const QUOTED = /[「『]([^「」『』]+)[」』]/g
const squash = (text: string) => text.replace(/\s/g, '')

/**
 * 脚本の鉤括弧のセリフのうち、どのページのセリフにも入っていないもの。脚本の順に、空白を除いた本文で比べる。
 * ページ割りの LLM はセリフを落としがちなので、追加の前に利用者へ見せる
 */
export function missingLines(script: string, plans: readonly PagePlan[]): string[] {
  const placed = plans.flatMap((p) => p.lines.map((l) => squash(l.text)))
  return [...script.matchAll(QUOTED)]
    .map((m) => (m[1] ?? '').trim())
    .filter((quote) => {
      const q = squash(quote)
      return q !== '' && !placed.some((l) => l.includes(q))
    })
}

/** コマ内に並べるフキダシの列数。超えた分は下の段へ回す */
const BUBBLE_COLUMNS = 3

/**
 * 1 コマのセリフを、読む順に読む向きの端から BUBBLE_COLUMNS 列ずつ並べたフキダシにする。
 * フキダシは fitBubble でコマの枠に収める
 */
export function lineBubbles(
  panel: Panel,
  lines: readonly PlanLine[],
  settings: Pick<Project['settings'], 'direction' | 'pageSize'>,
): Bubble[] {
  return lines.map((line, m) => {
    const column = (m % BUBBLE_COLUMNS) + 0.5
    const x = column / BUBBLE_COLUMNS
    const bubble = createBubble({
      order: m + 1,
      text: line.text,
      shape: line.shape,
      ...(line.speakerId !== undefined && { speakerId: line.speakerId }),
      pos: {
        x: settings.direction === 'rtl' ? 1 - x : x,
        y: 0.2 + Math.floor(m / BUBBLE_COLUMNS) * 0.3,
      },
    })
    return fitBubble(bubble, { panel, pageSize: settings.pageSize })
  })
}

/** セリフをコマ順のコマに読む順で均等に配り、lineBubbles でフキダシにする */
function distributeLines(
  panels: readonly Panel[],
  lines: readonly PlanLine[],
  settings: Pick<Project['settings'], 'direction' | 'pageSize'>,
): Panel[] {
  const ordered = [...panels].sort((a, b) => a.order - b.order)
  const byPanel = new Map<Panel, PlanLine[]>()
  lines.forEach((line, j) => {
    const panel = ordered[Math.floor((j * ordered.length) / lines.length)] as Panel
    byPanel.set(panel, [...(byPanel.get(panel) ?? []), line])
  })
  return panels.map((panel) => ({
    ...panel,
    bubbles: lineBubbles(panel, byPanel.get(panel) ?? [], settings),
  }))
}

/**
 * テンプレートのページに、ページ割りの流れ、脚本、登場キャラ、セリフを入れる。セリフはコマに配ったフキダシにし、
 * コマの無いテンプレートでは流れの後ろに 1 行ずつ書き足す。空の流れ、脚本、登場キャラは項目ごと持たない
 */
export function plannedPage(
  plan: PagePlan,
  template: PageTemplate | LayoutTemplate,
  project: Pick<Project, 'settings' | 'characters'>,
): Page {
  const page = createPage(template, project.settings.direction)
  const panelless = page.panels.length === 0
  const script = plan.script.trim()
  const note = [
    plan.note.trim(),
    ...(panelless ? plan.lines.map((l) => formatLine(l, project.characters)) : []),
  ]
    .filter((t) => t !== '')
    .join('\n')
  return {
    ...page,
    panels: panelless ? page.panels : distributeLines(page.panels, plan.lines, project.settings),
    ...(note !== '' && { note }),
    ...(script !== '' && { script }),
    ...(plan.cast.length > 0 && { cast: plan.cast }),
  }
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures, parseProject, newId } = await import('@manga/schema')

  test('parsePageCount', () => {
    expect(parsePageCount(' ')).toBeUndefined()
    expect(parsePageCount('3')).toBe(3)
    expect(parsePageCount('0')).toBeNull()
    expect(parsePageCount('1.5')).toBeNull()
    expect(parsePageCount(String(MAX_PAGE_COUNT + 1))).toBeNull()
    expect(parsePageCount('x')).toBeNull()
  })

  test('planRequest sends settings, characters, page count and the tone with the script', () => {
    const project = fixtures.samplePage01
    expect(planRequest(project, { script: ' E「…」\n', tone: '', pageCount: 2 })).toEqual({
      project: { settings: project.settings, characters: project.characters },
      script: 'E「…」',
      pageCount: 2,
    })
    const req = planRequest(project, { script: 'E「…」', tone: ' 静か ' })
    expect(req.script).toBe('（全体のトーン: 静か）\nE「…」')
    expect('pageCount' in req).toBe(false)
  })

  test('normalizePlan drops unknown and repeated characters, unknown speakers and empty lines', () => {
    const { characters } = fixtures.samplePage01
    expect(
      normalizePlan(
        {
          note: ' n ',
          script: ' s\n ',
          cast: ['chr_e', 'chr_x', 'chr_e'],
          lines: [
            { speakerId: 'chr_e', text: ' a ', shape: 'normal' },
            { speakerId: 'chr_x', text: 'b', shape: 'shout' },
            { text: ' ', shape: 'narration' },
          ],
        },
        characters,
      ),
    ).toEqual({
      note: 'n',
      script: 's',
      cast: ['chr_e'],
      lines: [
        { speakerId: 'chr_e', text: 'a', shape: 'normal' },
        { text: 'b', shape: 'shout' },
      ],
    })
  })

  test('missingLines lists the quoted lines of the script that no page carries', () => {
    const plans = [
      {
        note: 'n',
        script: 's',
        cast: [],
        lines: [{ text: '……ここ か', shape: 'normal' as const }],
      },
    ]
    expect(missingLines('E「……ここか」\nE『待って』\n森。「 」', plans)).toEqual(['待って'])
    expect(missingLines('森を歩く。', [])).toEqual([])
  })

  test('plannedPage puts the note, script, cast and lines as bubbles on a template page', () => {
    const project = fixtures.samplePage01
    const lines = [
      { speakerId: 'chr_e', text: 'a', shape: 'normal' as const },
      { text: 'b', shape: 'narration' as const },
      { text: 'c', shape: 'thought' as const },
    ]
    const planned = plannedPage(
      { note: 'n', script: 'E「a」', cast: ['chr_e'], lines },
      '2rows',
      project,
    )
    expect(planned).toMatchObject({ note: 'n', script: 'E「a」', cast: ['chr_e'] })
    expect(planned.panels).toHaveLength(createPage('2rows', 'rtl').panels.length)
    const bubbles = [...planned.panels].sort((a, b) => a.order - b.order).flatMap((p) => p.bubbles)
    expect(bubbles.map((b) => [b.text, b.shape, b.speakerId])).toEqual([
      ['a', 'normal', 'chr_e'],
      ['b', 'narration', undefined],
      ['c', 'thought', undefined],
    ])
    const empty = plannedPage({ note: ' ', script: ' ', cast: [], lines: [] }, '3rows', project)
    expect('cast' in empty || 'note' in empty || 'script' in empty).toBe(false)
    expect(empty.panels.every((p) => p.bubbles.length === 0)).toBe(true)
    expect(() =>
      parseProject({
        ...project,
        episodes: [...project.episodes, { id: newId(), title: '', pages: [planned] }],
      }),
    ).not.toThrow()
  })

  test('plannedPage writes the lines under the note on a page without panels', () => {
    const project = fixtures.samplePage01
    const lines = [
      { speakerId: 'chr_e', text: 'a', shape: 'normal' as const },
      { text: 'b', shape: 'narration' as const },
    ]
    const name = project.characters.find((c) => c.id === 'chr_e')?.name
    expect(plannedPage({ note: 'n', script: 's', cast: [], lines }, 'blank', project).note).toBe(
      `n\n${name}「a」\nb`,
    )
  })
}
