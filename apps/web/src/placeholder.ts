import { fixtures, type Page, type Project } from '@manga/schema'

/**
 * ProjectStore と StorageAdapter が配線されるまでの仮データ。フィクスチャ 1 件だけを持つ。
 * 各画面はここからプロジェクトとページを引く。
 */
export const placeholderProjects: readonly Project[] = [fixtures.samplePage01]

export function findProject(projectId: string): Project | undefined {
  return placeholderProjects.find((p) => p.id === projectId)
}

export function findPage(project: Project, pageId: string): Page | undefined {
  for (const episode of project.episodes) {
    const page = episode.pages.find((p) => p.id === pageId)
    if (page) return page
  }
  return undefined
}

export type ArtStatus = '未生成' | '一部' | '全部'

/** ページ内のコマのうち、現在の絵が選ばれているものの割合で 3 段階に分ける */
export function artStatus(page: Page): ArtStatus {
  const done = page.panels.filter((panel) => panel.artId !== undefined).length
  if (done === 0) return '未生成'
  if (done === page.panels.length) return '全部'
  return '一部'
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('artStatus', () => {
    const page = fixtures.samplePage01.episodes[0]?.pages[0]
    if (!page) throw new Error('fixture に page がない')
    expect(artStatus(page)).toBe('未生成')
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
    ).toBe('一部')
    expect(
      artStatus({
        ...page,
        panels: page.panels.map((p) => ({ ...p, arts: [art], artId: art.id })),
      }),
    ).toBe('全部')
  })
}
