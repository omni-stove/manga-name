import { normalizePlan, plannedPage } from '@manga/ai'
import { type Episode, newId, type PagePlan, type PageTemplate, type Project } from '@manga/schema'

/** `--template` に渡せる組み込みのコマ割り。並びは Web のテンプレートの選択肢と揃える */
export const TEMPLATES: readonly PageTemplate[] = ['2rows', '3rows', '4rows', 'blank']

/**
 * ページ割りを template のページにした、title の話。
 * Web の「脚本から下書き」と同じく、normalizePlan で project に居ないキャラを落としてから plannedPage で作る
 */
export function plannedEpisode(
  project: Pick<Project, 'settings' | 'characters'>,
  plans: readonly PagePlan[],
  template: PageTemplate,
  title: string,
): Episode {
  const pages = plans.map((plan) =>
    plannedPage(normalizePlan(plan, project.characters), template, project),
  )
  return { id: newId(), title, pages }
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { aiFixtures } = await import('@manga/ai')
  const { createEmptyProject, fixtures, parseProject } = await import('@manga/schema')

  test('makes a page per plan, and the episode fits in a project', () => {
    const project = createEmptyProject('t')
    const episode = plannedEpisode(project, aiFixtures.pagePlan, '2rows', '第1話')
    expect(episode.title).toBe('第1話')
    expect(episode.pages).toHaveLength(aiFixtures.pagePlan.length)
    expect(episode.pages[0]?.script).toBe(aiFixtures.pagePlan[0]?.script.trim())
    expect(episode.pages[0]?.cast).toBeUndefined()
    expect(() => parseProject({ ...project, episodes: [episode] })).not.toThrow()
  })

  test('keeps the cast and speakers who are in the project', () => {
    const episode = plannedEpisode(fixtures.samplePage01, aiFixtures.pagePlan, '2rows', 'x')
    expect(episode.pages[0]?.cast).toEqual(['chr_e'])
    expect(episode.pages[0]?.panels.flatMap((p) => p.bubbles)[0]?.speakerId).toBe('chr_e')
  })
}
