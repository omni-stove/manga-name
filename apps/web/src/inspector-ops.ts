import type { Bubble, FocusPoint, ID, Page, Panel, Patch, Project, Vector } from '@manga/schema'
import { findPage } from './project-ops'

/**
 * Inspector が出す「要素 root」の JSON Patch を Project root 基準に付け替える。
 * `replace /order` は、同じ order を持つ兄弟と入れ替える Patch を足す（order はページ内・コマ内で一意のため）
 */

const prefixed = (prefix: string, patch: Patch): Patch =>
  patch.map((op) => ({ ...op, path: `${prefix}${op.path}` }))

/** `replace /order` の相手を見つけ、その order を自分の元の order にする */
function orderSwaps(
  base: string,
  items: readonly { order: number }[],
  self: number,
  patch: Patch,
): Patch {
  const current = items[self]
  if (!current) return []
  return patch.flatMap((op) => {
    if (op.op !== 'replace' || op.path !== '/order' || typeof op.value !== 'number') return []
    const other = items.findIndex((item, i) => i !== self && item.order === op.value)
    if (other < 0) return []
    return [{ op: 'replace' as const, path: `${base}/${other}/order`, value: current.order }]
  })
}

export function findPanel(
  page: Page,
  panelId: ID,
): { panelIndex: number; panel: Panel } | undefined {
  const panelIndex = page.panels.findIndex((p) => p.id === panelId)
  const panel = page.panels[panelIndex]
  return panel ? { panelIndex, panel } : undefined
}

export function findBubble(
  page: Page,
  bubbleId: ID,
): { panelIndex: number; panel: Panel; bubbleIndex: number; bubble: Bubble } | undefined {
  for (const [panelIndex, panel] of page.panels.entries()) {
    const bubbleIndex = panel.bubbles.findIndex((b) => b.id === bubbleId)
    const bubble = panel.bubbles[bubbleIndex]
    if (bubble) return { panelIndex, panel, bubbleIndex, bubble }
  }
  return undefined
}

export function findFocus(
  page: Page,
  focusId: ID,
): { panelIndex: number; panel: Panel; focusIndex: number; focus: FocusPoint } | undefined {
  for (const [panelIndex, panel] of page.panels.entries()) {
    const focusIndex = panel.focusPoints.findIndex((f) => f.id === focusId)
    const focus = panel.focusPoints[focusIndex]
    if (focus) return { panelIndex, panel, focusIndex, focus }
  }
  return undefined
}

export function findVector(
  page: Page,
  vectorId: ID,
): { panelIndex: number; panel: Panel; vectorIndex: number; vector: Vector } | undefined {
  for (const [panelIndex, panel] of page.panels.entries()) {
    const vectorIndex = panel.vectors.findIndex((v) => v.id === vectorId)
    const vector = panel.vectors[vectorIndex]
    if (vector) return { panelIndex, panel, vectorIndex, vector }
  }
  return undefined
}

const pagePrefix = (project: Project, pageId: ID) => {
  const found = findPage(project, pageId)
  if (!found) throw new Error(`page ${pageId} is not in project ${project.id}`)
  return { page: found.page, prefix: `/episodes/${found.episodeIndex}/pages/${found.pageIndex}` }
}

/** Panel root の Patch を Project root に。無いコマなら throw */
export function panelPatch(project: Project, pageId: ID, panelId: ID, patch: Patch): Patch {
  const { page, prefix } = pagePrefix(project, pageId)
  const found = findPanel(page, panelId)
  if (!found) throw new Error(`panel ${panelId} is not in page ${pageId}`)
  const base = `${prefix}/panels`
  return [
    ...prefixed(`${base}/${found.panelIndex}`, patch),
    ...orderSwaps(base, page.panels, found.panelIndex, patch),
  ]
}

/** Bubble root の Patch を Project root に。無いフキダシなら throw */
export function bubblePatch(project: Project, pageId: ID, bubbleId: ID, patch: Patch): Patch {
  const { page, prefix } = pagePrefix(project, pageId)
  const found = findBubble(page, bubbleId)
  if (!found) throw new Error(`bubble ${bubbleId} is not in page ${pageId}`)
  const base = `${prefix}/panels/${found.panelIndex}/bubbles`
  return [
    ...prefixed(`${base}/${found.bubbleIndex}`, patch),
    ...orderSwaps(base, found.panel.bubbles, found.bubbleIndex, patch),
  ]
}

/** FocusPoint root の Patch を Project root に。無い焦点なら throw */
export function focusPatch(project: Project, pageId: ID, focusId: ID, patch: Patch): Patch {
  const { page, prefix } = pagePrefix(project, pageId)
  const found = findFocus(page, focusId)
  if (!found) throw new Error(`focus ${focusId} is not in page ${pageId}`)
  return prefixed(`${prefix}/panels/${found.panelIndex}/focusPoints/${found.focusIndex}`, patch)
}

/** Vector root の Patch を Project root に。無いベクトルなら throw */
export function vectorPatch(project: Project, pageId: ID, vectorId: ID, patch: Patch): Patch {
  const { page, prefix } = pagePrefix(project, pageId)
  const found = findVector(page, vectorId)
  if (!found) throw new Error(`vector ${vectorId} is not in page ${pageId}`)
  return prefixed(`${prefix}/panels/${found.panelIndex}/vectors/${found.vectorIndex}`, patch)
}

/**
 * 履歴から絵を 1 枚消す Patch。採用中の絵は消せない。
 * 消す絵を親に持つ絵は `parentId` を外す（parentId は arts の中を指す決まりのため）。アセットは残し、Undo で戻せる
 */
export function removeArtPatch(project: Project, pageId: ID, panelId: ID, artId: ID): Patch {
  const { page } = pagePrefix(project, pageId)
  const found = findPanel(page, panelId)
  if (!found) throw new Error(`panel ${panelId} is not in page ${pageId}`)
  const { panel } = found
  const index = panel.arts.findIndex((a) => a.id === artId)
  if (index < 0) throw new Error(`art ${artId} is not in panel ${panelId}`)
  if (panel.artId === artId) throw new Error('採用中の絵は削除できません')
  return panelPatch(project, pageId, panelId, [
    ...panel.arts.flatMap((a, i) =>
      a.parentId === artId ? [{ op: 'remove' as const, path: `/arts/${i}/parentId` }] : [],
    ),
    { op: 'remove', path: `/arts/${index}` },
  ])
}

/** Character root の Patch を Project root に。無いキャラクターなら throw */
export function characterPatch(project: Project, characterId: ID, patch: Patch): Patch {
  const index = project.characters.findIndex((c) => c.id === characterId)
  if (index < 0) throw new Error(`character ${characterId} is not in project ${project.id}`)
  return prefixed(`/characters/${index}`, patch)
}

/** ProjectSettings root の Patch を Project root に */
export function settingsInspectorPatch(patch: Patch): Patch {
  return prefixed('/settings', patch)
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const { createProjectStore } = await import('./store/project-store')

  const sample = fixtures.samplePage01
  const page = sample.episodes[0]?.pages[0]
  if (!page) throw new Error('fixture に page がない')
  const pageId = page.id
  const panelOf = (index: number) => {
    const panel = page.panels[index]
    if (!panel) throw new Error(`fixture に panel ${index} がない`)
    return panel
  }
  const storeOf = () => createProjectStore(sample, { saveProject: async () => {} })

  describe('panelPatch', () => {
    test('prefixes the panel path and the result is valid', () => {
      const panel = panelOf(2)
      const patch = panelPatch(sample, pageId, panel.id, [
        { op: 'add', path: '/note', value: 'n' },
        { op: 'add', path: '/camera', value: 'アオリ' },
      ])
      expect(patch).toEqual([
        { op: 'add', path: '/episodes/0/pages/0/panels/2/note', value: 'n' },
        { op: 'add', path: '/episodes/0/pages/0/panels/2/camera', value: 'アオリ' },
      ])
      const store = storeOf()
      store.applyPatch(patch)
      expect(store.get().episodes[0]?.pages[0]?.panels[2]?.note).toBe('n')
    })

    test('replace /order swaps with the panel that holds that order', () => {
      const panel = panelOf(0)
      const other = page.panels.findIndex((p) => p.order === 3)
      const patch = panelPatch(sample, pageId, panel.id, [
        { op: 'replace', path: '/order', value: 3 },
      ])
      expect(patch).toEqual([
        { op: 'replace', path: '/episodes/0/pages/0/panels/0/order', value: 3 },
        { op: 'replace', path: `/episodes/0/pages/0/panels/${other}/order`, value: panel.order },
      ])
      const store = storeOf()
      store.applyPatch(patch)
      const orders = store.get().episodes[0]?.pages[0]?.panels.map((p) => p.order) ?? []
      expect(new Set(orders).size).toBe(orders.length)
      expect(orders[0]).toBe(3)
    })

    test('replace /order to a free order swaps nothing', () => {
      const patch = panelPatch(sample, pageId, panelOf(0).id, [
        { op: 'replace', path: '/order', value: 99 },
      ])
      expect(patch).toHaveLength(1)
    })

    test('throws for an unknown page or panel', () => {
      expect(() => panelPatch(sample, 'nope', panelOf(0).id, [])).toThrow('page')
      expect(() => panelPatch(sample, pageId, 'nope', [])).toThrow('panel')
    })
  })

  describe('bubblePatch', () => {
    test('prefixes the bubble path inside its panel', () => {
      const bubble = panelOf(0).bubbles[0]
      if (!bubble) throw new Error('fixture に bubble がない')
      const patch = bubblePatch(sample, pageId, bubble.id, [
        { op: 'replace', path: '/text', value: 't' },
      ])
      expect(patch).toEqual([
        { op: 'replace', path: '/episodes/0/pages/0/panels/0/bubbles/0/text', value: 't' },
      ])
      const store = storeOf()
      store.applyPatch(patch)
      expect(store.get().episodes[0]?.pages[0]?.panels[0]?.bubbles[0]?.text).toBe('t')
      expect(() => bubblePatch(sample, pageId, 'nope', [])).toThrow('bubble')
    })

    test('replace /order swaps with the bubble that holds that order', () => {
      const first = panelOf(0).bubbles[0]
      if (!first) throw new Error('fixture に bubble がない')
      const store = storeOf()
      store.applyPatch([
        {
          op: 'add',
          path: '/episodes/0/pages/0/panels/0/bubbles/-',
          value: { ...first, id: 'bb_second', order: first.order + 1 },
        },
      ])
      const patch = bubblePatch(store.get(), pageId, 'bb_second', [
        { op: 'replace', path: '/order', value: first.order },
      ])
      expect(patch).toEqual([
        { op: 'replace', path: '/episodes/0/pages/0/panels/0/bubbles/1/order', value: first.order },
        {
          op: 'replace',
          path: '/episodes/0/pages/0/panels/0/bubbles/0/order',
          value: first.order + 1,
        },
      ])
      store.applyPatch(patch)
      expect(store.get().episodes[0]?.pages[0]?.panels[0]?.bubbles.map((b) => b.order)).toEqual([
        first.order + 1,
        first.order,
      ])
    })
  })

  describe('removeArtPatch', () => {
    const art = (id: string, parentId?: string) => ({
      id,
      ref: `blob:${id}`,
      provider: 'fake',
      prompt: 'p',
      createdAt: '2026-10-16T00:00:00.000Z',
      ...(parentId && { parentId }),
    })
    const withArts = () => {
      const store = storeOf()
      store.applyPatch([
        { op: 'add', path: '/episodes/0/pages/0/panels/0/arts/-', value: art('a1') },
        { op: 'add', path: '/episodes/0/pages/0/panels/0/arts/-', value: art('a2', 'a1') },
        { op: 'add', path: '/episodes/0/pages/0/panels/0/arts/-', value: art('a3', 'a2') },
        { op: 'add', path: '/episodes/0/pages/0/panels/0/artId', value: 'a3' },
      ])
      return store
    }

    test('removes the art and clears the parentId of its children', () => {
      const store = withArts()
      const patch = removeArtPatch(store.get(), pageId, panelOf(0).id, 'a1')
      expect(patch).toEqual([
        { op: 'remove', path: '/episodes/0/pages/0/panels/0/arts/1/parentId' },
        { op: 'remove', path: '/episodes/0/pages/0/panels/0/arts/0' },
      ])
      store.applyPatch(patch)
      const arts = store.get().episodes[0]?.pages[0]?.panels[0]?.arts ?? []
      expect(arts.map((a) => a.id)).toEqual(['a2', 'a3'])
      expect(arts[0]?.parentId).toBeUndefined()
      expect(arts[1]?.parentId).toBe('a2')
    })

    test('refuses the adopted art and unknown ids', () => {
      const store = withArts()
      expect(() => removeArtPatch(store.get(), pageId, panelOf(0).id, 'a3')).toThrow('採用中')
      expect(() => removeArtPatch(store.get(), pageId, panelOf(0).id, 'nope')).toThrow('art')
      expect(() => removeArtPatch(store.get(), pageId, 'nope', 'a1')).toThrow('panel')
    })
  })

  test('characterPatch prefixes by index and throws for an unknown id', () => {
    const character = sample.characters[0]
    if (!character) throw new Error('fixture に character がない')
    expect(characterPatch(sample, character.id, [{ op: 'remove', path: '/appearance' }])).toEqual([
      { op: 'remove', path: '/characters/0/appearance' },
    ])
    expect(() => characterPatch(sample, 'nope', [])).toThrow('character')
  })

  test('settingsInspectorPatch prefixes /settings', () => {
    const patch = settingsInspectorPatch([{ op: 'replace', path: '/dpi', value: 600 }])
    expect(patch).toEqual([{ op: 'replace', path: '/settings/dpi', value: 600 }])
    const store = storeOf()
    store.applyPatch(patch)
    expect(store.get().settings.dpi).toBe(600)
  })
}
