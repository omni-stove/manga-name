import type { LayoutSuggestionRequest, NameDraftRequest } from '@manga/ai'
import {
  type Character,
  createRowPanels,
  type ID,
  type LayoutOption,
  NameDraftSchema,
  type NamePanel,
  type Page,
  type Panel,
  type Patch,
  type Project,
} from '@manga/schema'
import { lineBubbles } from './page-plan'
import { pagePatch } from './project-ops'
import { readStorage, writeStorage } from './use-stored-flag'

/** ネームの書き起こしの要求。ページの脚本は前後の空白を落として送る */
export function nameRequest(
  project: Pick<Project, 'settings' | 'characters'>,
  script: string,
): NameDraftRequest {
  return {
    project: { settings: project.settings, characters: project.characters },
    script: script.trim(),
  }
}

/** 直している途中のネームのコマを、前後の空白を落とし、空のカメラとセリフを捨てた形にする */
function normalizeNamePanel({ camera, ...panel }: NamePanel): NamePanel {
  const trimmedCamera = camera?.trim() ?? ''
  return {
    ...panel,
    note: panel.note.trim(),
    ...(trimmedCamera !== '' && { camera: trimmedCamera }),
    lines: panel.lines.flatMap((line) => {
      const text = line.text.trim()
      return text === '' ? [] : [{ ...line, text }]
    }),
  }
}

/** ネームからコマ割りを提案できるか。枠の大きさを描くものから決めるので、描くものの無いコマがあれば提案しない */
export const isNameReady = (panels: readonly NamePanel[]) =>
  panels.length > 0 && panels.every((p) => p.note.trim() !== '')

/** コマ index の先頭のセリフを前のコマの末尾へ（by -1）、末尾のセリフを次のコマの先頭へ（by 1）移したネーム */
export function moveEdgeLine(panels: NamePanel[], index: number, by: -1 | 1): NamePanel[] {
  const from = panels[index]
  const line = by === -1 ? from?.lines[0] : from?.lines.at(-1)
  if (!line || !panels[index + by]) return panels
  return panels.map((p, i) => {
    if (i === index) return { ...p, lines: by === -1 ? p.lines.slice(1) : p.lines.slice(0, -1) }
    if (i === index + by)
      return { ...p, lines: by === -1 ? [...p.lines, line] : [line, ...p.lines] }
    return p
  })
}

/** コマ割りの提案の要求。ネームのコマは normalizeNamePanel にかけて送る */
export function layoutRequest(panels: readonly NamePanel[]): LayoutSuggestionRequest {
  return { panels: panels.map(normalizeNamePanel) }
}

/**
 * 案の枠にネームのコマを読む順に当てたコマにする。枠は createRowPanels で段とコマの比から割り、
 * 描くものを指示メモ、カメラを camera、セリフを lineBubbles のフキダシにする。
 * 居ない話し手は落とし、空のセリフは捨てる。ネームより枠が多ければ余りの枠は空のままにする
 */
export function suggestedPanels(
  option: LayoutOption,
  name: readonly NamePanel[],
  settings: Pick<Project['settings'], 'direction' | 'pageSize'>,
  characters: readonly Character[],
): Panel[] {
  const known = (id: string) => characters.some((c) => c.id === id)
  const frames = createRowPanels(
    option.rows.map((row) => ({ height: row.height, widths: row.panels.map((p) => p.width) })),
    settings.direction,
  )
  return frames.map((frame, i) => {
    const source = name[i]
    if (!source) return frame
    const panel = normalizeNamePanel(source)
    return {
      ...frame,
      ...(panel.note !== '' && { note: panel.note }),
      ...(panel.camera !== undefined && { camera: panel.camera }),
      bubbles: lineBubbles(
        frame,
        panel.lines.map(({ speakerId, ...line }) => ({
          ...line,
          ...(speakerId !== undefined && known(speakerId) && { speakerId }),
        })),
        settings,
      ),
    }
  })
}

/** 案に置き換えたページ。プレビューに使い、コマのほかは元のまま */
export function suggestedPage(
  page: Page,
  option: LayoutOption,
  name: readonly NamePanel[],
  settings: Pick<Project['settings'], 'direction' | 'pageSize'>,
  characters: readonly Character[],
): Page {
  return { ...page, panels: suggestedPanels(option, name, settings, characters) }
}

const nameKey = (pageId: ID) => `manga.name.${pageId}`

/** このブラウザに残したページのネーム。無いか読めなければ undefined */
export function loadName(pageId: ID): NamePanel[] | undefined {
  const stored = readStorage(nameKey(pageId))
  if (stored === null) return undefined
  try {
    const parsed = NameDraftSchema.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** ページのネームをこのブラウザに残す。プロジェクトには入れず、コマ割りを提案し直すときの下書きにだけ使う */
export function saveName(pageId: ID, panels: readonly NamePanel[]): void {
  writeStorage(nameKey(pageId), JSON.stringify(panels))
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
  const { expect, onTestFinished, test, vi } = import.meta.vitest
  const { aiFixtures } = await import('@manga/ai')
  const { fixtures, parseProject, newId, createPage } = await import('@manga/schema')

  const project = fixtures.samplePage01
  const [option] = aiFixtures.layoutSuggestion.options
  if (!option) throw new Error('fixture has no option')
  const name = aiFixtures.nameDraft.panels

  test('nameRequest sends settings, characters and the trimmed script', () => {
    expect(nameRequest(project, ' E「……」\n')).toEqual({
      project: { settings: project.settings, characters: project.characters },
      script: 'E「……」',
    })
  })

  test('layoutRequest trims the name and drops empty cameras and lines', () => {
    expect(
      layoutRequest([
        {
          note: ' 森 ',
          camera: ' ',
          lines: [
            { text: ' a ', shape: 'normal' },
            { text: '', shape: 'normal' },
          ],
        },
      ]),
    ).toEqual({ panels: [{ note: '森', lines: [{ text: 'a', shape: 'normal' }] }] })
  })

  test('isNameReady needs a panel and a note on every panel', () => {
    expect(isNameReady(name)).toBe(true)
    expect(isNameReady([])).toBe(false)
    expect(isNameReady([...name, { note: ' ', lines: [] }])).toBe(false)
  })

  test('moveEdgeLine moves the edge line to the neighbouring panel and keeps the name at the ends', () => {
    const a = { text: 'a', shape: 'normal' as const }
    const b = { text: 'b', shape: 'normal' as const }
    const panels = [
      { note: '1', lines: [a] },
      { note: '2', lines: [b] },
    ]
    expect(moveEdgeLine(panels, 0, 1).map((p) => p.lines)).toEqual([[], [a, b]])
    expect(moveEdgeLine(panels, 1, -1).map((p) => p.lines)).toEqual([[a, b], []])
    expect(moveEdgeLine(panels, 0, -1)).toBe(panels)
    expect(moveEdgeLine(panels, 1, 1)).toBe(panels)
    expect(moveEdgeLine([{ note: '1', lines: [] }, ...panels], 0, 1)[1]).toBe(panels[0])
  })

  test('suggestedPanels puts the name panels into the frames in reading order', () => {
    const panels = suggestedPanels(option, name, project.settings, project.characters)
    expect(panels.map((p) => p.order)).toEqual(name.map((_, i) => i + 1))
    expect(panels.map((p) => p.note)).toEqual(name.map((p) => p.note))
    expect(panels.map((p) => p.camera)).toEqual(name.map((p) => p.camera))
    expect(panels.map((p) => p.bubbles.map((b) => [b.text, b.shape, b.speakerId]))).toEqual(
      name.map((p) => p.lines.map((l) => [l.text, l.shape, l.speakerId])),
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
    const panels = suggestedPanels(option, name, project.settings, project.characters)
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
    const preview = suggestedPage(page, option, name, project.settings, project.characters)
    expect(preview).toMatchObject({ id: page.id, script: 's' })
    expect(preview.panels).toHaveLength(panels.length)
  })

  test('suggestedPanels leaves the frames past the name empty', () => {
    const [first] = name
    if (!first) throw new Error('fixture has no name panel')
    const panels = suggestedPanels(option, [first], project.settings, project.characters)
    expect(panels).toHaveLength(name.length)
    expect(panels.slice(1).every((p) => p.note === undefined && p.bubbles.length === 0)).toBe(true)
  })

  test('saveName and loadName keep a name being edited per page', () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    })
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
    const pageId = newId()
    expect(loadName(pageId)).toBeUndefined()
    const editing = [{ note: '', lines: [{ text: '', shape: 'normal' as const }] }, ...name]
    saveName(pageId, editing)
    expect(loadName(pageId)).toEqual(editing)
    localStorage.setItem(`manga.name.${pageId}`, '{')
    expect(loadName(pageId)).toBeUndefined()
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
