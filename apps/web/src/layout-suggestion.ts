import type { LayoutSuggestionRequest } from '@manga/ai'
import {
  createRowPanels,
  type ID,
  type LayoutOption,
  type Page,
  type Panel,
  type Patch,
  type Project,
} from '@manga/schema'
import { lineBubbles } from './page-plan'
import { pagePatch } from './project-ops'

/** コマ割りの提案の要求。ページの脚本は前後の空白を落として送る */
export function layoutRequest(
  project: Pick<Project, 'settings' | 'characters'>,
  script: string,
): LayoutSuggestionRequest {
  return {
    project: { settings: project.settings, characters: project.characters },
    script: script.trim(),
  }
}

/**
 * 案を空のコマから組んだコマにする。枠は createRowPanels で段とコマの比から割り、
 * 描くものを指示メモ、カメラを camera、セリフを lineBubbles のフキダシにする
 */
export function suggestedPanels(
  option: LayoutOption,
  settings: Pick<Project['settings'], 'direction' | 'pageSize'>,
): Panel[] {
  const suggested = option.rows.flatMap((row) => row.panels)
  const frames = createRowPanels(
    option.rows.map((row) => ({ height: row.height, widths: row.panels.map((p) => p.width) })),
    settings.direction,
  )
  return frames.map((frame, i) => {
    const panel = suggested[i]
    if (!panel) return frame
    return {
      ...frame,
      note: panel.note,
      ...(panel.camera !== undefined && { camera: panel.camera }),
      bubbles: lineBubbles(frame, panel.lines, settings),
    }
  })
}

/** 案に置き換えたページ。プレビューに使い、コマのほかは元のまま */
export function suggestedPage(
  page: Page,
  option: LayoutOption,
  settings: Pick<Project['settings'], 'direction' | 'pageSize'>,
): Page {
  return { ...page, panels: suggestedPanels(option, settings) }
}

/** ページのコマを panels で置き換える Project 根の Patch */
export function replacePanelsPatch(project: Project, pageId: ID, panels: Panel[]): Patch {
  return pagePatch(project, pageId, [{ op: 'replace', path: '/panels', value: panels }])
}

/** 置き換えると消える中身（絵、フキダシ、焦点、ベクトル、指示メモ）がページのコマにあるか */
export function hasPanelContent(page: Page): boolean {
  return page.panels.some(
    (p) =>
      p.arts.length > 0 ||
      p.bubbles.length > 0 ||
      p.focusPoints.length > 0 ||
      p.vectors.length > 0 ||
      p.note !== undefined,
  )
}

/** 位置をロックしたコマがあるか。ロックしたコマは AI の提案で動かさないので、置き換えを止める */
export const hasLockedPanel = (page: Page) => page.panels.some((p) => p.locked === true)

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { aiFixtures } = await import('@manga/ai')
  const { fixtures, parseProject, newId, createPage } = await import('@manga/schema')

  const project = fixtures.samplePage01
  const [option] = aiFixtures.layoutSuggestion.options
  if (!option) throw new Error('fixture has no option')

  test('layoutRequest sends settings, characters and the trimmed script', () => {
    expect(layoutRequest(project, ' E「……」\n')).toEqual({
      project: { settings: project.settings, characters: project.characters },
      script: 'E「……」',
    })
  })

  test('suggestedPanels turns rows into panels in reading order with notes, cameras and bubbles', () => {
    const panels = suggestedPanels(option, project.settings)
    const suggested = option.rows.flatMap((row) => row.panels)
    expect(panels.map((p) => p.order)).toEqual(suggested.map((_, i) => i + 1))
    expect(panels.map((p) => p.note)).toEqual(suggested.map((p) => p.note))
    expect(panels.map((p) => p.camera)).toEqual(suggested.map((p) => p.camera))
    expect(panels.map((p) => p.bubbles.map((b) => [b.text, b.shape, b.speakerId]))).toEqual(
      suggested.map((p) => p.lines.map((l) => [l.text, l.shape, l.speakerId])),
    )
    const [, second, third] = panels
    if (!second || !third) throw new Error('2 段目のコマが 2 つない')
    // rtl なので、2 段目は読む順の先のコマが右に来る
    expect(second.rect.x).toBeGreaterThan(third.rect.x)
  })

  test('replacePanelsPatch puts a page with the suggested panels into a valid project', () => {
    const page = { ...createPage('3rows', 'rtl'), script: 's' }
    const base = parseProject({
      ...project,
      episodes: [...project.episodes, { id: newId(), title: '', pages: [page] }],
    })
    const panels = suggestedPanels(option, project.settings)
    const patch = replacePanelsPatch(base, page.id, panels)
    expect(patch).toEqual([
      {
        op: 'replace',
        path: `/episodes/${base.episodes.length - 1}/pages/0/panels`,
        value: panels,
      },
    ])
    const replaced = { ...page, panels }
    expect(() =>
      parseProject({
        ...base,
        episodes: base.episodes.map((e, i) =>
          i === base.episodes.length - 1 ? { ...e, pages: [replaced] } : e,
        ),
      }),
    ).not.toThrow()
    const preview = suggestedPage(page, option, project.settings)
    expect(preview).toMatchObject({ id: page.id, script: 's' })
    expect(preview.panels).toHaveLength(panels.length)
  })

  test('hasPanelContent and hasLockedPanel', () => {
    const empty = createPage('2rows', 'rtl')
    expect(hasPanelContent(empty)).toBe(false)
    expect(hasLockedPanel(empty)).toBe(false)
    const sample = project.episodes[0]?.pages[0] as Page
    expect(hasPanelContent(sample)).toBe(true)
    const [first, ...rest] = empty.panels
    if (!first) throw new Error('2rows のページにコマがない')
    expect(hasLockedPanel({ ...empty, panels: [{ ...first, locked: true }, ...rest] })).toBe(true)
  })
}
