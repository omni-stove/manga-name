import type { ID, Panel } from './project'

type ScenePage = { id: ID; panels: readonly Pick<Panel, 'id' | 'order' | 'scene'>[] }

/** コマが持つシーンの見出し。空白だけの見出しは持たないものとして undefined */
export function sceneHeading(panel: Pick<Panel, 'scene'>): string | undefined {
  const heading = panel.scene?.trim()
  return heading ? heading : undefined
}

/**
 * ページ pageId の各コマが属するシーン。読み順（pages の並び、ページの中は order）で、そのコマか直前の見出しを持つ
 * コマの見出しで、前のページに遡る。どのシーンにも属さないコマは入れない。キーは Panel.id。
 * pages は 1 話分を渡す。pageId が pages に無ければ空
 */
export function pageScenes(
  pages: readonly ScenePage[],
  pageId: ID,
): Record<ID, string> {
  let current: string | undefined
  for (const page of pages) {
    const scenes: Record<ID, string> = {}
    for (const panel of [...page.panels].sort((a, b) => a.order - b.order)) {
      current = sceneHeading(panel) ?? current
      if (current !== undefined) scenes[panel.id] = current
    }
    if (page.id === pageId) return scenes
  }
  return {}
}

/** コマ panelId が属するシーン（pageScenes）。どのシーンにも属さなければ undefined */
export function sceneOf(
  pages: readonly ScenePage[],
  pageId: ID,
  panelId: ID,
): string | undefined {
  return pageScenes(pages, pageId)[panelId]
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  const page = (id: string, panels: { id: string; order: number; scene?: string }[]) => ({
    id,
    panels,
  })

  const pages = [
    page('p1', [
      { id: 'a', order: 1 },
      { id: 'b', order: 2, scene: '放課後・屋上' },
      { id: 'c', order: 3 },
    ]),
    page('p2', [
      // 配列の並びではなく order の順に読む
      { id: 'f', order: 3 },
      { id: 'e', order: 2, scene: ' 夜・帰り道 ' },
      { id: 'd', order: 1 },
    ]),
    page('p3', [
      { id: 'g', order: 1, scene: '  ' },
      { id: 'h', order: 2 },
    ]),
  ]

  test('sceneOf takes the scene of the panel or the last panel before it with one', () => {
    expect(sceneOf(pages, 'p1', 'a')).toBeUndefined()
    expect(sceneOf(pages, 'p1', 'b')).toBe('放課後・屋上')
    expect(sceneOf(pages, 'p1', 'c')).toBe('放課後・屋上')
  })

  test('sceneOf goes back to the previous pages and reads each page in order', () => {
    expect(sceneOf(pages, 'p2', 'd')).toBe('放課後・屋上')
    expect(sceneOf(pages, 'p2', 'e')).toBe('夜・帰り道')
    expect(sceneOf(pages, 'p2', 'f')).toBe('夜・帰り道')
  })

  test('a blank scene starts no scene', () => {
    expect(sceneHeading({ scene: '  ' })).toBeUndefined()
    expect(sceneOf(pages, 'p3', 'g')).toBe('夜・帰り道')
    expect(sceneOf(pages, 'p3', 'h')).toBe('夜・帰り道')
  })

  test('pageScenes leaves out panels before the first scene and is empty for an unknown page', () => {
    expect(pageScenes(pages, 'p1')).toEqual({ b: '放課後・屋上', c: '放課後・屋上' })
    expect(pageScenes(pages, 'missing')).toEqual({})
    expect(sceneOf(pages, 'p1', 'missing')).toBeUndefined()
  })
}
