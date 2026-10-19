import { m } from '@manga/i18n'
import {
  brokenSpreads,
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
  pageSlots,
  spreadStartsAt,
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
  if (!found) throw new Error(m.web_common_page_gone())
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

/** ページのコマ割りを name のテンプレートとして末尾に登録する。コマが無いページ、見開きのページと空の名前は throw */
export function addLayoutTemplatePatch(
  project: Project,
  pageId: ID,
  name: string,
): { patch: Patch; template: LayoutTemplate } {
  const found = findPage(project, pageId)
  if (!found) throw new Error(m.web_common_page_gone())
  if (found.page.panels.length === 0) throw new Error(m.web_template_no_panels())
  if (found.page.spread) throw new Error(m.web_template_spread())
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
 * 並びか始まりの左右を変えたエピソードで、見開きが新しく割れるなら throw する。
 * もとから割れている見開き（同時編集で入ったものなど）は、それを直さない操作も止めないよう数えない
 */
function assertSpreadsKept(
  project: Project,
  before: Pick<Episode, 'pages' | 'startsRight'>,
  after: Pick<Episode, 'pages' | 'startsRight'>,
): void {
  const { direction } = project.settings
  const broken = new Set(brokenSpreads(before, direction))
  if (brokenSpreads(after, direction).some((id) => !broken.has(id))) {
    throw new Error(m.web_episode_spread_breaks())
  }
}

/** 次に足すページから見開きを始められるか。エピソードが無ければ、足すときに作る 1 話目で見る */
export function canAddSpread(project: Project, episodeId?: ID): boolean {
  const episode =
    episodeId === undefined ? project.episodes.at(-1) : project.episodes.find((e) => e.id === episodeId)
  const slots = pageSlots(episode ?? { pages: [] })
  const last = slots.at(-1)
  const next = last ? last.number + (last.page.spread ? 2 : 1) : 1
  return spreadStartsAt(next, episode?.startsRight === true, project.settings.direction)
}

/**
 * テンプレートからページを作り、エピソードの末尾に足す。
 * `episodeId` を省くと最後のエピソードに足し、エピソードが無ければ 1 話目を作ってそこに入れる。
 * `spread` なら見開きのページにする。組み込みのテンプレートしか受けず、見開きを始められない位置（canAddSpread）なら throw する
 */
export function addPagePatch(
  project: Project,
  template: PageTemplate | LayoutTemplate,
  episodeId?: ID,
  spread = false,
): { patch: Patch; page: Page } {
  if (!spread) {
    const page = createPage(template, project.settings.direction)
    return { patch: appendPagesPatch(project, [page], episodeId), page }
  }
  if (typeof template === 'object') throw new Error(m.web_episode_spread_builtin_only())
  if (!canAddSpread(project, episodeId)) throw new Error(m.web_episode_spread_breaks())
  const page = createPage(template, project.settings.direction, true)
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

/** ページを消す。後ろの見開きが割れるなら throw する（canRemovePage） */
export function removePagePatch(project: Project, pageId: ID): Patch {
  const found = findPage(project, pageId)
  if (!found) return []
  const episode = project.episodes[found.episodeIndex] as Episode
  assertSpreadsKept(project, episode, {
    ...episode,
    pages: episode.pages.filter((p) => p.id !== pageId),
  })
  return [{ op: 'remove', path: `/episodes/${found.episodeIndex}/pages/${found.pageIndex}` }]
}

/** 消しても見開きが割れないか */
export function canRemovePage(project: Project, pageId: ID): boolean {
  return succeeds(() => removePagePatch(project, pageId))
}

/** エピソード内でページを `delta` だけ動かす。端を越える移動は空の patch。見開きが割れるなら throw する（canMovePage） */
export function movePagePatch(project: Project, pageId: ID, delta: number): Patch {
  const found = findPage(project, pageId)
  if (!found) return []
  const episode = project.episodes[found.episodeIndex] as Episode
  const pages = episode.pages
  const to = found.pageIndex + delta
  if (delta === 0 || to < 0 || to >= pages.length) return []
  const moved = pages.filter((p) => p.id !== pageId)
  moved.splice(to, 0, found.page)
  assertSpreadsKept(project, episode, { ...episode, pages: moved })
  const base = `/episodes/${found.episodeIndex}/pages`
  // PatchSchema に move が無いので remove と add で動かす。add の添字は remove 後の配列で解決される
  return [
    { op: 'remove', path: `${base}/${found.pageIndex}` },
    { op: 'add', path: `${base}/${to}`, value: found.page },
  ]
}

/** 動かしても見開きが割れず、端も越えないか */
export function canMovePage(project: Project, pageId: ID, delta: number): boolean {
  return succeeds(() => movePagePatch(project, pageId, delta).length > 0)
}

/** 1 ページ目を右ページにするか切り替える。見開きが割れるなら throw する（canSetStartsRight） */
export function startsRightPatch(project: Project, episodeId: ID, startsRight: boolean): Patch {
  const index = project.episodes.findIndex((e) => e.id === episodeId)
  const episode = project.episodes[index]
  if (!episode || (episode.startsRight === true) === startsRight) return []
  assertSpreadsKept(project, episode, { pages: episode.pages, ...(startsRight && { startsRight }) })
  const path = `/episodes/${index}/startsRight`
  return startsRight ? [{ op: 'add', path, value: true }] : [{ op: 'remove', path }]
}

/** 始まりの左右を切り替えても見開きが割れないか */
export function canSetStartsRight(project: Project, episodeId: ID, startsRight: boolean): boolean {
  return succeeds(() => startsRightPatch(project, episodeId, startsRight))
}

function succeeds(run: () => unknown): boolean {
  try {
    return run() !== false
  } catch {
    return false
  }
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

/** 全キャラ共通のデザインを変える。空なら項目ごと消し、同じ値なら空の Patch */
export function characterDesignPatch(current: ProjectSettings, next: string): Patch {
  const path = '/settings/characterDesign'
  if (next === '') return current.characterDesign === undefined ? [] : [{ op: 'remove', path }]
  if (next === current.characterDesign) return []
  // JSON Patch の add は既存のメンバーを置き換えるので、有無を分けずに済む
  return [{ op: 'add', path, value: next }]
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
        {
          id: expect.any(String),
          title: m.web_episode_default_title({ number: 1 }),
          pages: [page],
        },
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
      expect(b?.title).toBe(m.web_episode_default_title({ number: 2 }))
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
      expect(() => renameEpisodePatch(store.get(), episode.id, ' ')).toThrow(m.web_name_required())
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

    test('a spread is added only where it starts on the right, and nothing may split it', () => {
      const store = storeOf(sample)
      const ids = () => store.get().episodes[0]?.pages.map((p) => p.id) ?? []
      const episodeId = store.get().episodes[0]?.id as ID
      // 1 ページ目は左なので、次の 2 ページ目（右）から見開きを始められる
      expect(canAddSpread(store.get())).toBe(true)
      store.applyPatch(addPagePatch(store.get(), '2rows', undefined, true).patch)
      const spreadId = ids()[1] as ID
      expect(store.get().episodes[0]?.pages[1]?.spread).toBe(true)
      store.applyPatch(addPagePatch(store.get(), 'blank').patch)
      const [first, , last] = ids()
      if (!first || !last) throw new Error('page が 3 つない')
      // 次は 5 ページ目（左）
      expect(canAddSpread(store.get())).toBe(false)
      expect(() => addPagePatch(store.get(), '2rows', undefined, true)).toThrow(
        m.web_episode_spread_breaks(),
      )

      expect(canRemovePage(store.get(), first)).toBe(false)
      expect(() => removePagePatch(store.get(), first)).toThrow(m.web_episode_spread_breaks())
      expect(canRemovePage(store.get(), last)).toBe(true)
      expect(canRemovePage(store.get(), spreadId)).toBe(true)
      expect(canMovePage(store.get(), last, -1)).toBe(false)
      expect(canMovePage(store.get(), last, 1)).toBe(false)
      expect(canSetStartsRight(store.get(), episodeId, true)).toBe(false)
      expect(startsRightPatch(store.get(), episodeId, false)).toEqual([])

      store.applyPatch(removePagePatch(store.get(), spreadId))
      store.applyPatch(startsRightPatch(store.get(), episodeId, true))
      expect(store.get().episodes[0]?.startsRight).toBe(true)
      store.applyPatch(startsRightPatch(store.get(), episodeId, false))
      expect(store.get().episodes[0]?.startsRight).toBeUndefined()
    })

    test('a spread takes only a built-in template', () => {
      const { template } = addLayoutTemplatePatch(sample, firstPage().id, 'six')
      expect(() => addPagePatch(sample, template, undefined, true)).toThrow(
        m.web_episode_spread_builtin_only(),
      )
      // 見開きのコマ割りは 1 ページの紙面に合わないので、登録もさせない
      const store = storeOf(sample)
      const { patch, page } = addPagePatch(store.get(), '2rows', undefined, true)
      store.applyPatch(patch)
      expect(() => addLayoutTemplatePatch(store.get(), page.id, 'spread')).toThrow(
        m.web_template_spread(),
      )
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
      expect(() => resolveTemplate(store.get(), first.template.id)).toThrow(
        m.web_template_not_found(),
      )
    })

    test('refuses a page without panels and an empty name', () => {
      const store = storeOf(createEmptyProject('t'))
      const { page } = addPagePatch(store.get(), 'blank')
      store.applyPatch(addPagePatch(store.get(), 'blank').patch)
      const blank = store.get().episodes[0]?.pages[0]
      if (!blank) throw new Error('page を足せていない')
      expect(() => addLayoutTemplatePatch(store.get(), blank.id, 'a')).toThrow(
        m.web_template_no_panels(),
      )
      expect(() => addLayoutTemplatePatch(sample, firstPage().id, ' ')).toThrow(
        m.web_name_required(),
      )
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
      expect(() => addCharacterPatch({ name: '', shortName: 'x' })).toThrow(m.web_name_required())
      expect(() => addCharacterPatch({ name: 'x', shortName: ' ' })).toThrow(
        m.web_short_name_required(),
      )
    })

    test('remove refuses a character that is still referenced', () => {
      const used = sample.characters.find((c) => characterUsage(sample, c.id) > 0)
      if (!used) throw new Error('fixture に参照されているキャラクターがない')
      expect(() => removeCharacterPatch(sample, used.id)).toThrow(
        m.web_character_used_in_panels({ count: characterUsage(sample, used.id) }),
      )

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
      expect(() => removeCharacterPatch(store.get(), character.id)).toThrow(
        m.web_character_used_in_panels({ count: 1 }),
      )
    })

    test('a character only in a page cast cannot be removed', () => {
      const store = storeOf(structuredClone(sample))
      const { patch, character } = addCharacterPatch({ name: 'A', shortName: 'A' })
      store.applyPatch([
        ...patch,
        { op: 'add', path: '/episodes/0/pages/0/cast', value: [character.id] },
      ])
      expect(characterUsage(store.get(), character.id)).toBe(0)
      expect(() => removeCharacterPatch(store.get(), character.id)).toThrow(
        m.web_character_used_in_cast({ count: 1 }),
      )
    })
  })

  describe('pagePatch', () => {
    test('prefixes a page-rooted patch with the episode and page index', () => {
      const page = firstPage()
      expect(pagePatch(sample, page.id, [{ op: 'remove', path: '/panels/1' }])).toEqual([
        { op: 'remove', path: '/episodes/0/pages/0/panels/1' },
      ])
      expect(() => pagePatch(sample, 'nope', [])).toThrow(m.web_common_page_gone())
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

  test('characterDesignPatch adds, replaces and removes the shared design', () => {
    const project = createEmptyProject('t')
    const store = storeOf(project)
    expect(characterDesignPatch(project.settings, '')).toEqual([])
    store.applyPatch(characterDesignPatch(store.get().settings, '6 頭身'))
    expect(store.get().settings.characterDesign).toBe('6 頭身')
    expect(characterDesignPatch(store.get().settings, '6 頭身')).toEqual([])
    store.applyPatch(characterDesignPatch(store.get().settings, '8 頭身'))
    expect(store.get().settings.characterDesign).toBe('8 頭身')
    store.applyPatch(characterDesignPatch(store.get().settings, ''))
    expect(store.get().settings).not.toHaveProperty('characterDesign')
    expect(ProjectSchema.safeParse(store.get()).success).toBe(true)
  })
}
