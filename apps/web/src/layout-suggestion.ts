import { type LayoutSuggestionRequest, lineBubbles, type NameDraftRequest } from '@manga/ai'
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
  pageSizeOf,
  panelActing,
} from '@manga/schema'
import { pagePatch } from './project-ops'
import { readStorage, writeStorage } from './use-stored-flag'

/**
 * ネームの書き起こしの要求。ページの脚本は前後の空白を落として送る。
 * ページに今あるコマの芝居を読む順に添え、芝居のあるコマが無ければ添えない
 */
export function nameRequest(
  project: Pick<Project, 'settings' | 'characters'>,
  script: string,
  page?: Pick<Page, 'panels'>,
): NameDraftRequest {
  const current = [...(page?.panels ?? [])]
    .sort((a, b) => a.order - b.order)
    .flatMap((panel) => {
      const acting = panelActing(panel).map((a) => ({ ...a, text: a.text.trim() }))
      if (acting.length === 0) return []
      const note = panel.note?.trim()
      return [note ? { note, acting } : { acting }]
    })
  return {
    project: { settings: project.settings, characters: project.characters },
    script: script.trim(),
    ...(current.length > 0 && { current }),
  }
}

/** 直している途中のネームのコマを、前後の空白を落とし、空のセリフと空の芝居を捨てた形にする */
function normalizeNamePanel({ acting, ...panel }: NamePanel): NamePanel {
  const kept = (acting ?? []).flatMap((a) => {
    const text = a.text.trim()
    return text === '' ? [] : [{ ...a, text }]
  })
  return {
    ...panel,
    note: panel.note.trim(),
    lines: panel.lines.flatMap((line) => {
      const text = line.text.trim()
      return text === '' ? [] : [{ ...line, text }]
    }),
    ...(kept.length > 0 && { acting: kept }),
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
 * 描くものを指示メモ、カメラを camera、セリフを lineBubbles のフキダシ、芝居を acting にする。
 * 芝居だけのキャラは cast に足す。panelActing は登場キャラの芝居しか拾わず、セリフの無いキャラは cast でしか登場キャラにならないため。
 * 居ない話し手と居ないキャラの芝居は落とし、空のセリフと空の芝居は捨てる。ネームより枠が多ければ余りの枠は空のままにする
 */
export function suggestedPanels(
  page: Pick<Page, 'spread'>,
  option: LayoutOption,
  name: readonly NamePanel[],
  settings: Pick<Project['settings'], 'direction' | 'pageSize'>,
  characters: readonly Character[],
): Panel[] {
  const known = (id: string) => characters.some((c) => c.id === id)
  const frames = createRowPanels(
    option.rows.map((row) => ({ height: row.height, widths: row.panels.map((p) => p.width) })),
    settings.direction,
    page,
  )
  return frames.map((frame, i) => {
    const source = name[i]
    if (!source) return frame
    const panel = normalizeNamePanel(source)
    const lines = panel.lines.map(({ speakerId, ...line }) => ({
      ...line,
      ...(speakerId !== undefined && known(speakerId) && { speakerId }),
    }))
    const acting = (panel.acting ?? []).filter(
      (a, ai, all) =>
        known(a.characterId) && all.findIndex((b) => b.characterId === a.characterId) === ai,
    )
    const cast = acting
      .map((a) => a.characterId)
      .filter((id) => !lines.some((l) => l.speakerId === id))
    return {
      ...frame,
      ...(panel.note !== '' && { note: panel.note }),
      ...(panel.camera !== undefined && { camera: panel.camera }),
      ...(cast.length > 0 && { cast }),
      ...(acting.length > 0 && { acting }),
      bubbles: lineBubbles(frame, lines, {
        ...settings,
        pageSize: pageSizeOf(page, settings.pageSize),
      }),
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
  return { ...page, panels: suggestedPanels(page, option, name, settings, characters) }
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

/** 置き換えると消える中身（絵、フキダシ、焦点、ベクトル、指示メモ、芝居）がページのコマにあるか */
export function hasPanelContent(page: Page): boolean {
  return page.panels.some(
    (p) =>
      p.arts.length > 0 ||
      p.bubbles.length > 0 ||
      p.focusPoints.length > 0 ||
      p.vectors.length > 0 ||
      p.note !== undefined ||
      p.acting !== undefined,
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

  test('nameRequest adds the acting of the current panels in reading order', () => {
    const page = project.episodes[0]?.pages[0] as Page
    const acted: Page = {
      ...page,
      panels: page.panels.map((p) =>
        p.order === 2
          ? { ...p, note: ' 振り返る ', acting: [{ characterId: 'chr_e', text: ' 驚く ' }] }
          : p.order === 1
            ? { ...p, note: undefined, acting: [{ characterId: 'chr_e', text: '歩く' }] }
            : { ...p, acting: [{ characterId: 'chr_e', text: ' ' }] },
      ),
    }
    expect(nameRequest(project, 's', acted).current).toEqual([
      { acting: [{ characterId: 'chr_e', text: '歩く' }] },
      { note: '振り返る', acting: [{ characterId: 'chr_e', text: '驚く' }] },
    ])
    expect(nameRequest(project, 's', page)).not.toHaveProperty('current')
  })

  test('layoutRequest trims the name and drops empty lines and acting', () => {
    expect(
      layoutRequest([
        {
          note: ' 森 ',
          lines: [
            { text: ' a ', shape: 'normal' },
            { text: '', shape: 'normal' },
          ],
        },
      ]),
    ).toEqual({ panels: [{ note: '森', lines: [{ text: 'a', shape: 'normal' }] }] })
    expect(
      layoutRequest([
        {
          note: '森',
          lines: [],
          acting: [
            { characterId: 'chr_e', text: ' 歩く ' },
            { characterId: 'chr_k', text: ' ' },
          ],
        },
      ]).panels[0]?.acting,
    ).toEqual([{ characterId: 'chr_e', text: '歩く' }])
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
    const panels = suggestedPanels({}, option, name, project.settings, project.characters)
    expect(panels.map((p) => p.order)).toEqual(name.map((_, i) => i + 1))
    expect(panels.map((p) => p.note)).toEqual(name.map((p) => p.note))
    expect(panels.map((p) => p.camera)).toEqual(name.map((p) => p.camera))
    expect(panels.map((p) => p.bubbles.map((b) => [b.text, b.shape, b.speakerId]))).toEqual(
      name.map((p) => p.lines.map((l) => [l.text, l.shape, l.speakerId])),
    )
    expect(panels.map((p) => p.acting)).toEqual(name.map((p) => p.acting))
    const [, second, third] = panels
    if (!second || !third) throw new Error('2 段目のコマが 2 つない')
    // rtl なので、2 段目は読む順の先のコマが右に来る
    expect(second.rect.x).toBeGreaterThan(third.rect.x)
  })

  test('suggestedPanels casts the characters who only act and drops unknown or repeated acting', () => {
    const [panel] = suggestedPanels(
      {},
      { summary: 's', rows: [{ height: 1, panels: [{ width: 1 }] }] },
      [
        {
          note: '振り向く',
          lines: [],
          acting: [
            { characterId: 'chr_e', text: ' 振り向いて驚く ' },
            { characterId: 'chr_missing', text: '笑う' },
            { characterId: 'chr_e', text: '泣く' },
          ],
        },
      ],
      project.settings,
      project.characters,
    )
    expect(panel?.acting).toEqual([{ characterId: 'chr_e', text: '振り向いて驚く' }])
    expect(panel?.cast).toEqual(['chr_e'])
    if (!panel) throw new Error('コマが無い')
    expect(panelActing(panel)).toEqual(panel.acting)

    const [speaking] = suggestedPanels(
      {},
      { summary: 's', rows: [{ height: 1, panels: [{ width: 1 }] }] },
      [
        {
          note: 'n',
          lines: [{ speakerId: 'chr_e', text: 'a', shape: 'normal' }],
          acting: [{ characterId: 'chr_e', text: '笑う' }],
        },
      ],
      project.settings,
      project.characters,
    )
    expect(speaking?.cast).toBeUndefined()
    expect(speaking?.acting).toEqual([{ characterId: 'chr_e', text: '笑う' }])

    const [blank] = suggestedPanels(
      {},
      { summary: 's', rows: [{ height: 1, panels: [{ width: 1 }] }] },
      [{ note: 'n', lines: [], acting: [{ characterId: 'chr_e', text: ' ' }] }],
      project.settings,
      project.characters,
    )
    expect(blank?.acting).toBeUndefined()
    expect(blank?.cast).toBeUndefined()
  })

  test('replacePanelsPatch puts a page with the suggested panels into a valid project', () => {
    const page = { ...createPage('3rows', 'rtl'), script: 's' }
    const base = parseProject({
      ...project,
      episodes: [...project.episodes, { id: newId(), title: '', pages: [page] }],
    })
    const panels = suggestedPanels(page, option, name, project.settings, project.characters)
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
    const panels = suggestedPanels({}, option, [first], project.settings, project.characters)
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
