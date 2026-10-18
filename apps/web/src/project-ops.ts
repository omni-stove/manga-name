import { m } from '@manga/i18n'
import {
  type Character,
  createLayoutTemplate,
  createPage,
  type Episode,
  type ID,
  type LayoutTemplate,
  newId,
  type Page,
  type PageTemplate,
  type Patch,
  type Project,
  type ProjectSettings,
  panelCharacterIds,
} from '@manga/schema'

/**
 * エピソード一覧・ページ一覧・キャラクター・設定の画面が使う操作。どれも Project を変えず、
 * ProjectStore.applyPatch に渡す JSON Patch を返す。
 */

interface PageLocation {
  episodeIndex: number
  pageIndex: number
  page: Page
}

export function findPage(project: Project, pageId: ID): PageLocation | undefined {
  for (const [episodeIndex, episode] of project.episodes.entries()) {
    const pageIndex = episode.pages.findIndex((p) => p.id === pageId)
    const page = episode.pages[pageIndex]
    if (page) return { episodeIndex, pageIndex, page }
  }
  return undefined
}

/** page を root とした JSON Patch を Project root 基準に付け替える。無いページなら throw */
export function pagePatch(project: Project, pageId: ID, patch: Patch): Patch {
  const found = findPage(project, pageId)
  if (!found) throw new Error(`page ${pageId} is not in project ${project.id}`)
  const prefix = `/episodes/${found.episodeIndex}/pages/${found.pageIndex}`
  return patch.map((op) => ({ ...op, path: `${prefix}${op.path}` }))
}

type ArtStatus = 'none' | 'partial' | 'all'

/** ページ内のコマのうち、現在の絵が選ばれているものの割合で 3 段階に分ける。コマが無いページは none */
export function artStatus(page: Page): ArtStatus {
  const done = page.panels.filter((panel) => panel.artId !== undefined).length
  if (done === 0) return 'none'
  if (done === page.panels.length) return 'all'
  return 'partial'
}

export const ART_STATUS_LABELS: Record<ArtStatus, () => string> = {
  none: () => m.web_art_status_none(),
  partial: () => m.web_art_status_partial(),
  all: () => m.web_art_status_all(),
}

const PAGE_TEMPLATES: readonly { value: PageTemplate; label: () => string }[] = [
  { value: '2rows', label: () => m.web_page_template_2rows() },
  { value: '3rows', label: () => m.web_page_template_3rows() },
  { value: '4rows', label: () => m.web_page_template_4rows() },
  { value: 'blank', label: () => m.web_page_template_blank() },
]

/**
 * ページを足すときのテンプレートの選択肢。組み込み（PAGE_TEMPLATES）の後に、登録したコマ割りを登録順に並べる。
 * 登録したものの value はその id
 */
export function templateOptions(
  project: Pick<Project, 'layoutTemplates'>,
): { value: string; label: string; registered: boolean }[] {
  return [
    ...PAGE_TEMPLATES.map((t) => ({ value: t.value, label: t.label(), registered: false })),
    ...(project.layoutTemplates ?? []).map((t) => ({
      value: t.id,
      label: t.name,
      registered: true,
    })),
  ]
}

/** templateOptions の value をテンプレートに戻す。登録したコマ割りが消えていれば throw */
export function resolveTemplate(
  project: Pick<Project, 'layoutTemplates'>,
  value: string,
): PageTemplate | LayoutTemplate {
  const builtIn = PAGE_TEMPLATES.find((t) => t.value === value)
  if (builtIn) return builtIn.value
  const registered = project.layoutTemplates?.find((t) => t.id === value)
  if (!registered) throw new Error(m.web_template_not_found())
  return registered
}

/** ページのコマ割りを name のテンプレートとして末尾に登録する。コマが無いページと空の名前は throw */
export function addLayoutTemplatePatch(
  project: Project,
  pageId: ID,
  name: string,
): { patch: Patch; template: LayoutTemplate } {
  const found = findPage(project, pageId)
  if (!found) throw new Error(`page ${pageId} is not in project ${project.id}`)
  if (found.page.panels.length === 0) throw new Error(m.web_template_no_panels())
  if (!name.trim()) throw new Error(m.web_name_required())
  const template = createLayoutTemplate(found.page, name)
  // 登録が無いプロジェクトは layoutTemplates を持たないので、配列ごと足す
  const patch: Patch = project.layoutTemplates
    ? [{ op: 'add', path: '/layoutTemplates/-', value: template }]
    : [{ op: 'add', path: '/layoutTemplates', value: [template] }]
  return { patch, template }
}

/** 登録したコマ割りを消す。最後の 1 つなら layoutTemplates ごと消す。無ければ空の patch */
export function removeLayoutTemplatePatch(project: Project, templateId: ID): Patch {
  const templates = project.layoutTemplates ?? []
  const index = templates.findIndex((t) => t.id === templateId)
  if (index < 0) return []
  return [
    {
      op: 'remove',
      path: templates.length === 1 ? '/layoutTemplates' : `/layoutTemplates/${index}`,
    },
  ]
}

const newEpisode = (project: Project, pages: Page[] = []): Episode => ({
  id: newId(),
  title: m.web_episode_default_title({ number: project.episodes.length + 1 }),
  pages,
})

/** 空のエピソードを末尾に足す。足したエピソードも返すので、追加のあとにそこへ移れる */
export function addEpisodePatch(project: Project): { patch: Patch; episode: Episode } {
  const episode = newEpisode(project)
  return { patch: [{ op: 'add', path: '/episodes/-', value: episode }], episode }
}

/** 前後の空白を落として話の名前を置き換える。空の名前は throw し、変わらなければ空の patch */
export function renameEpisodePatch(project: Project, episodeId: ID, title: string): Patch {
  const index = project.episodes.findIndex((e) => e.id === episodeId)
  if (index < 0) throw new Error(m.web_episode_not_found_id({ id: episodeId }))
  const next = title.trim()
  if (!next) throw new Error(m.web_name_required())
  if (next === project.episodes[index]?.title) return []
  return [{ op: 'replace', path: `/episodes/${index}/title`, value: next }]
}

/** エピソードをページごと消す。無いエピソードなら空の patch */
export function removeEpisodePatch(project: Project, episodeId: ID): Patch {
  const index = project.episodes.findIndex((e) => e.id === episodeId)
  if (index < 0) return []
  return [{ op: 'remove', path: `/episodes/${index}` }]
}

/**
 * テンプレートからページを作り、エピソードの末尾に足す。
 * `episodeId` を省くと最後のエピソードに足し、エピソードが無ければ 1 話目を作ってそこに入れる。
 */
export function addPagePatch(
  project: Project,
  template: PageTemplate | LayoutTemplate,
  episodeId?: ID,
): { patch: Patch; page: Page } {
  const page = createPage(template, project.settings.direction)
  return { patch: appendPagesPatch(project, [page], episodeId), page }
}

/**
 * `pages` を順にエピソードの末尾に足す。1 回の applyPatch で入れれば Undo 1 回で全部戻る。
 * 追加先の決め方は addPagePatch と同じ
 */
export function appendPagesPatch(project: Project, pages: Page[], episodeId?: ID): Patch {
  if (pages.length === 0) return []
  if (project.episodes.length === 0) {
    return [{ op: 'add', path: '/episodes/-', value: newEpisode(project, pages) }]
  }
  const index =
    episodeId === undefined
      ? project.episodes.length - 1
      : project.episodes.findIndex((e) => e.id === episodeId)
  if (index < 0) throw new Error(m.web_episode_not_found_id({ id: String(episodeId) }))
  return pages.map((page) => ({
    op: 'add' as const,
    path: `/episodes/${index}/pages/-`,
    value: page,
  }))
}

export function removePagePatch(project: Project, pageId: ID): Patch {
  const found = findPage(project, pageId)
  if (!found) return []
  return [{ op: 'remove', path: `/episodes/${found.episodeIndex}/pages/${found.pageIndex}` }]
}

/** エピソード内でページを `delta` だけ動かす。端を越える移動は空の patch */
export function movePagePatch(project: Project, pageId: ID, delta: number): Patch {
  const found = findPage(project, pageId)
  if (!found) return []
  const pages = project.episodes[found.episodeIndex]?.pages ?? []
  const to = found.pageIndex + delta
  if (delta === 0 || to < 0 || to >= pages.length) return []
  const base = `/episodes/${found.episodeIndex}/pages`
  // PatchSchema に move が無いので remove と add で動かす。add の添字は remove 後の配列で解決される
  return [
    { op: 'remove', path: `${base}/${found.pageIndex}` },
    { op: 'add', path: `${base}/${to}`, value: found.page },
  ]
}

export type CharacterFields = Pick<Character, 'name' | 'shortName'> &
  Partial<Pick<Character, 'appearance' | 'note' | 'referenceRef'>>

const OPTIONAL_FIELDS = ['appearance', 'note', 'referenceRef'] as const

/** 前後の空白を落とし、空の任意項目は持たない形にする */
function normalize(fields: CharacterFields): CharacterFields {
  const result: CharacterFields = { name: fields.name.trim(), shortName: fields.shortName.trim() }
  for (const key of OPTIONAL_FIELDS) {
    const value = fields[key]?.trim()
    if (value) result[key] = value
  }
  return result
}

function validate(fields: CharacterFields): void {
  if (!fields.name) throw new Error(m.web_name_required())
  if (!fields.shortName) throw new Error(m.web_short_name_required())
}

export function addCharacterPatch(fields: CharacterFields): { patch: Patch; character: Character } {
  const character = { id: newId(), ...normalize(fields) }
  validate(character)
  return { patch: [{ op: 'add', path: '/characters/-', value: character }], character }
}

/** 登場キャラ、セリフの話者、フォーカスポイントのどれかとして参照しているコマの数 */
export function characterUsage(project: Project, id: ID): number {
  let count = 0
  for (const episode of project.episodes) {
    for (const page of episode.pages) {
      for (const panel of page.panels) {
        if (panelCharacterIds(panel).includes(id)) count++
      }
    }
  }
  return count
}

/** ページの登場キャラ（Page.cast）に入れているページの数 */
function pageCastUsage(project: Project, id: ID): number {
  return project.episodes.flatMap((e) => e.pages).filter((p) => p.cast?.includes(id)).length
}

/** 参照が残るキャラクターは消すとスキーマを通らなくなるので、理由を添えて throw する */
export function removeCharacterPatch(project: Project, id: ID): Patch {
  const index = project.characters.findIndex((c) => c.id === id)
  if (index < 0) return []
  const usage = characterUsage(project, id)
  if (usage > 0) throw new Error(m.web_character_used_in_panels({ count: usage }))
  const pages = pageCastUsage(project, id)
  if (pages > 0) throw new Error(m.web_character_used_in_cast({ count: pages }))
  return [{ op: 'remove', path: `/characters/${index}` }]
}

const SETTINGS_FIELDS = ['direction', 'pageSize', 'dpi'] as const

/** 設定画面で編集する項目のうち、変わったものだけを置き換える */
export function settingsPatch(
  current: ProjectSettings,
  next: Pick<ProjectSettings, (typeof SETTINGS_FIELDS)[number]>,
): Patch {
  return SETTINGS_FIELDS.filter(
    (key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]),
  ).map((key) => ({ op: 'replace' as const, path: `/settings/${key}`, value: next[key] }))
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { createEmptyProject, fixtures, ProjectSchema } = await import('@manga/schema')
  const { createProjectStore } = await import('./store/project-store')

  const storeOf = (project: Project) => createProjectStore(project, { saveProject: async () => {} })
  const sample = fixtures.samplePage01
  const firstPage = () => {
    const page = sample.episodes[0]?.pages[0]
    if (!page) throw new Error('fixture に page がない')
    return page
  }

  test('artStatus', () => {
    const page = firstPage()
    expect(artStatus(page)).toBe('none')
    expect(artStatus({ ...page, panels: [] })).toBe('none')
    const [first, ...rest] = page.panels
    if (!first) throw new Error('fixture に panel がない')
    const art = {
      id: 'art_1',
      ref: 'blob:x',
      provider: 'fake',
      prompt: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    expect(
      artStatus({ ...page, panels: [{ ...first, arts: [art], artId: art.id }, ...rest] }),
    ).toBe('partial')
    expect(
      artStatus({
        ...page,
        panels: page.panels.map((p) => ({ ...p, arts: [art], artId: art.id })),
      }),
    ).toBe('all')
  })

  describe('pages', () => {
    test('addPage creates the first episode of an empty project', () => {
      const store = storeOf(createEmptyProject('t'))
      const { patch, page } = addPagePatch(store.get(), '3rows')
      store.applyPatch(patch)
      expect(store.get().episodes).toEqual([
        { id: expect.any(String), title: '第1話', pages: [page] },
      ])
      expect(page.panels).toHaveLength(6)
    })

    test('addPage appends to the given or last episode', () => {
      const store = storeOf(sample)
      store.applyPatch(addEpisodePatch(store.get()).patch)
      const [first, second] = store.get().episodes
      if (!first || !second) throw new Error('episode が 2 つない')
      store.applyPatch(addPagePatch(store.get(), 'blank').patch)
      store.applyPatch(addPagePatch(store.get(), '2rows', first.id).patch)
      const [a, b] = store.get().episodes
      expect(a?.pages.map((p) => p.panels.length)).toEqual([6, 4])
      expect(b?.pages.map((p) => p.panels.length)).toEqual([0])
      expect(b?.title).toBe('第2話')
      expect(() => addPagePatch(store.get(), 'blank', 'nope')).toThrow()
    })

    test('appendPages adds every page in one Undo step', () => {
      const store = storeOf(createEmptyProject('t'))
      const pages = [createPage('blank', 'rtl'), createPage('2rows', 'rtl')]
      store.applyPatch(appendPagesPatch(store.get(), pages))
      expect(store.get().episodes[0]?.pages).toEqual(pages)

      const more = [createPage('3rows', 'rtl'), createPage('4rows', 'rtl')]
      store.applyPatch(appendPagesPatch(store.get(), more), { source: 'ai' })
      expect(store.get().episodes[0]?.pages).toEqual([...pages, ...more])
      store.undo()
      expect(store.get().episodes[0]?.pages).toEqual(pages)
      expect(appendPagesPatch(store.get(), [])).toEqual([])
      expect(() => appendPagesPatch(store.get(), more, 'nope')).toThrow()
    })

    test('movePage reorders within the episode and ignores moves past the ends', () => {
      const store = storeOf(sample)
      store.applyPatch(addPagePatch(store.get(), 'blank').patch)
      store.applyPatch(addPagePatch(store.get(), '2rows').patch)
      const ids = () => store.get().episodes[0]?.pages.map((p) => p.id) ?? []
      const [p1, p2, p3] = ids()
      if (!p1 || !p2 || !p3) throw new Error('page が 3 つない')

      store.applyPatch(movePagePatch(store.get(), p1, 1))
      expect(ids()).toEqual([p2, p1, p3])
      store.applyPatch(movePagePatch(store.get(), p3, -2))
      expect(ids()).toEqual([p3, p2, p1])
      expect(movePagePatch(store.get(), p3, -1)).toEqual([])
      expect(movePagePatch(store.get(), p1, 1)).toEqual([])
      expect(movePagePatch(store.get(), 'nope', 1)).toEqual([])
      store.undo()
      expect(ids()).toEqual([p2, p1, p3])
    })

    test('renameEpisode trims the title and refuses an empty one', () => {
      const store = storeOf(sample)
      const episode = store.get().episodes[0]
      if (!episode) throw new Error('fixture に episode がない')
      store.applyPatch(renameEpisodePatch(store.get(), episode.id, ' 出会い '))
      expect(store.get().episodes[0]?.title).toBe('出会い')
      expect(renameEpisodePatch(store.get(), episode.id, '出会い')).toEqual([])
      expect(() => renameEpisodePatch(store.get(), episode.id, ' ')).toThrow('名前')
      expect(() => renameEpisodePatch(store.get(), 'nope', 'x')).toThrow()
      store.undo()
      expect(store.get().episodes[0]?.title).toBe(episode.title)
    })

    test('removeEpisode drops the episode with its pages, and undo brings them back', () => {
      const store = storeOf(sample)
      const episode = store.get().episodes[0]
      if (!episode) throw new Error('fixture に episode がない')
      store.applyPatch(removeEpisodePatch(store.get(), episode.id))
      expect(store.get().episodes).toEqual([])
      expect(removeEpisodePatch(store.get(), episode.id)).toEqual([])
      store.undo()
      expect(store.get().episodes[0]).toEqual(episode)
    })

    test('removePage', () => {
      const store = storeOf(sample)
      store.applyPatch(removePagePatch(store.get(), firstPage().id))
      expect(store.get().episodes[0]?.pages).toEqual([])
      expect(removePagePatch(store.get(), firstPage().id)).toEqual([])
    })
  })

  describe('layout templates', () => {
    test('register a page layout, add a page from it, and remove it', () => {
      const store = storeOf(structuredClone(sample))
      const source = store.get().episodes[0]?.pages[0]
      if (!source) throw new Error('fixture に page がない')
      const first = addLayoutTemplatePatch(store.get(), source.id, ' 6 コマ ')
      store.applyPatch(first.patch)
      const second = addLayoutTemplatePatch(store.get(), source.id, '別名')
      store.applyPatch(second.patch)
      expect(ProjectSchema.safeParse(store.get()).success).toBe(true)
      expect(store.get().layoutTemplates?.map((t) => t.name)).toEqual(['6 コマ', '別名'])
      expect(templateOptions(store.get()).at(-2)).toEqual({
        value: first.template.id,
        label: '6 コマ',
        registered: true,
      })

      const template = resolveTemplate(store.get(), first.template.id)
      store.applyPatch(addPagePatch(store.get(), template).patch)
      const added = store.get().episodes[0]?.pages.at(-1)
      expect(added?.panels.map((p) => p.rect)).toEqual(source.panels.map((p) => p.rect))
      expect(added?.panels.every((p) => p.bubbles.length === 0)).toBe(true)
      expect(resolveTemplate(store.get(), '2rows')).toBe('2rows')

      store.applyPatch(removeLayoutTemplatePatch(store.get(), first.template.id))
      expect(store.get().layoutTemplates?.map((t) => t.id)).toEqual([second.template.id])
      store.applyPatch(removeLayoutTemplatePatch(store.get(), second.template.id))
      expect(store.get().layoutTemplates).toBeUndefined()
      expect(removeLayoutTemplatePatch(store.get(), second.template.id)).toEqual([])
      expect(() => resolveTemplate(store.get(), first.template.id)).toThrow('見つかりません')
    })

    test('refuses a page without panels and an empty name', () => {
      const store = storeOf(createEmptyProject('t'))
      const { page } = addPagePatch(store.get(), 'blank')
      store.applyPatch(addPagePatch(store.get(), 'blank').patch)
      const blank = store.get().episodes[0]?.pages[0]
      if (!blank) throw new Error('page を足せていない')
      expect(() => addLayoutTemplatePatch(store.get(), blank.id, 'a')).toThrow('コマが無い')
      expect(() => addLayoutTemplatePatch(sample, firstPage().id, ' ')).toThrow('名前')
      expect(() => addLayoutTemplatePatch(sample, page.id, 'a')).toThrow()
    })
  })

  describe('characters', () => {
    test('add trims and drops empty optional fields', () => {
      const store = storeOf(createEmptyProject('t'))
      const { patch, character } = addCharacterPatch({
        name: ' 山田 ',
        shortName: '山',
        appearance: ' ',
        note: '主人公',
        referenceRef: 'asset:a',
      })
      store.applyPatch(patch)
      expect(store.get().characters).toEqual([
        {
          id: character.id,
          name: '山田',
          shortName: '山',
          note: '主人公',
          referenceRef: 'asset:a',
        },
      ])
      expect(() => addCharacterPatch({ name: '', shortName: 'x' })).toThrow('名前')
      expect(() => addCharacterPatch({ name: 'x', shortName: ' ' })).toThrow('略称')
    })

    test('remove refuses a character that is still referenced', () => {
      const used = sample.characters.find((c) => characterUsage(sample, c.id) > 0)
      if (!used) throw new Error('fixture に参照されているキャラクターがない')
      expect(() => removeCharacterPatch(sample, used.id)).toThrow('削除できません')

      const store = storeOf(createEmptyProject('t'))
      const { patch, character } = addCharacterPatch({ name: 'A', shortName: 'A' })
      store.applyPatch(patch)
      store.applyPatch(removeCharacterPatch(store.get(), character.id))
      expect(store.get().characters).toEqual([])
    })

    test('a character only in a panel cast counts as used', () => {
      const store = storeOf(structuredClone(sample))
      const { patch, character } = addCharacterPatch({ name: 'A', shortName: 'A' })
      store.applyPatch([
        ...patch,
        { op: 'add', path: '/episodes/0/pages/0/panels/0/cast', value: [character.id] },
      ])
      expect(characterUsage(store.get(), character.id)).toBe(1)
      expect(() => removeCharacterPatch(store.get(), character.id)).toThrow('削除できません')
    })

    test('a character only in a page cast cannot be removed', () => {
      const store = storeOf(structuredClone(sample))
      const { patch, character } = addCharacterPatch({ name: 'A', shortName: 'A' })
      store.applyPatch([
        ...patch,
        { op: 'add', path: '/episodes/0/pages/0/cast', value: [character.id] },
      ])
      expect(characterUsage(store.get(), character.id)).toBe(0)
      expect(() => removeCharacterPatch(store.get(), character.id)).toThrow('1 ページの登場キャラ')
    })
  })

  describe('pagePatch', () => {
    test('prefixes a page-rooted patch with the episode and page index', () => {
      const page = firstPage()
      expect(pagePatch(sample, page.id, [{ op: 'remove', path: '/panels/1' }])).toEqual([
        { op: 'remove', path: '/episodes/0/pages/0/panels/1' },
      ])
      expect(() => pagePatch(sample, 'nope', [])).toThrow('page')
    })

    test('a Delete from the canvas comes back with Undo', () => {
      const page = firstPage()
      const store = storeOf(sample)
      const panels = () => store.get().episodes[0]?.pages[0]?.panels ?? []
      store.applyPatch(pagePatch(store.get(), page.id, [{ op: 'remove', path: '/panels/1' }]), {
        source: 'user',
        label: 'キャンバスの編集',
      })
      expect(panels().map((p) => p.id)).toEqual(['pn_1', 'pn_3', 'pn_4', 'pn_5', 'pn_6'])
      store.applyPatch(
        pagePatch(store.get(), page.id, [{ op: 'remove', path: '/panels/1/bubbles/0' }]),
      )
      expect(panels()[1]?.bubbles).toEqual([])
      store.undo()
      store.undo()
      expect(panels()).toEqual(page.panels)
      store.redo()
      expect(panels()).toHaveLength(5)
    })
  })

  test('settingsPatch replaces only changed fields and the result is valid', () => {
    const project = createEmptyProject('t')
    const { settings } = project
    expect(settingsPatch(settings, settings)).toEqual([])
    const patch = settingsPatch(settings, {
      ...settings,
      direction: 'ltr',
      pageSize: { ...settings.pageSize, w: 210 },
    })
    expect(patch.map((op) => op.path)).toEqual(['/settings/direction', '/settings/pageSize'])
    const store = storeOf(project)
    store.applyPatch(patch)
    expect(ProjectSchema.safeParse(store.get()).success).toBe(true)
    expect(store.get().settings.pageSize.w).toBe(210)
  })
}
