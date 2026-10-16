import type { Page, Patch } from '@manga/schema'
import { findFocus, findVector, moveFocusPatch } from './hint-ops'
import type { Selection } from './types'

/** 1 回のキー操作で動かす正規化座標の量 */
export const NUDGE_STEP = 0.01
/** Shift 付きのときの倍率 */
export const NUDGE_SHIFT_FACTOR = 10

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
// 0.01 刻みの加算で 0.30000000000000004 のような値を残さない
const round = (v: number) => Math.round(v * 1000) / 1000

/** 選択要素の JSON Pointer（ページ root 基準）。無ければ undefined */
function pointerOf(page: Page, selection: Selection): string | undefined {
  if (selection === null) return undefined
  if (selection.kind === 'panel') {
    const i = page.panels.findIndex((p) => p.id === selection.id)
    return i < 0 ? undefined : `/panels/${i}`
  }
  if (selection.kind === 'bubble') {
    for (const [i, panel] of page.panels.entries()) {
      const j = panel.bubbles.findIndex((b) => b.id === selection.id)
      if (j >= 0) return `/panels/${i}/bubbles/${j}`
    }
    return undefined
  }
  const at = selection.kind === 'focus' ? findFocus(page, selection.id) : findVector(page, selection.id)
  if (!at) return undefined
  return `/panels/${at.panelIndex}/${selection.kind === 'focus' ? 'focusPoints' : 'vectors'}/${at.index}`
}

/** 選択要素を消す Patch。消せる要素が無ければ空 */
export function removePatch(page: Page, selection: Selection): Patch {
  const pointer = pointerOf(page, selection)
  if (pointer === undefined) return []
  const patch: Patch = []
  if (selection?.kind === 'bubble' || selection?.kind === 'focus') {
    // PanelSchema は vector の焦点参照がコマ内に実在することを要求するため、先に参照を外す
    for (const [i, panel] of page.panels.entries()) {
      for (const [j, vector] of panel.vectors.entries()) {
        for (const key of ['sourceFocusId', 'targetFocusId'] as const) {
          if (vector[key] === selection.id) {
            patch.push({ op: 'remove', path: `/panels/${i}/vectors/${j}/${key}` })
          }
        }
      }
    }
  }
  patch.push({ op: 'remove', path: pointer })
  return patch
}

/**
 * 選択要素を正規化座標で (dx, dy) 動かす Patch。コマはページの中に、
 * フキダシの中心としっぽ、焦点、ベクトルの両端はコマ内座標の 0..1 に収める。動かない軸は出さない。
 * 焦点は繋がったベクトルの端も一緒に動かす
 */
export function nudgePatch(page: Page, selection: Selection, dx: number, dy: number): Patch {
  const pointer = pointerOf(page, selection)
  if (pointer === undefined || selection === null) return []
  const patch: Patch = []
  const move = (path: string, from: number, delta: number, max: number) => {
    if (delta === 0) return
    const to = round(clamp(from + delta, 0, max))
    if (to !== from) patch.push({ op: 'replace', path: `${pointer}${path}`, value: to })
  }
  if (selection.kind === 'panel') {
    const panel = page.panels.find((p) => p.id === selection.id)
    if (!panel) return []
    move('/rect/x', panel.rect.x, dx, 1 - panel.rect.w)
    move('/rect/y', panel.rect.y, dy, 1 - panel.rect.h)
    return patch
  }
  if (selection.kind === 'bubble') {
    const bubble = page.panels.flatMap((p) => p.bubbles).find((b) => b.id === selection.id)
    if (!bubble) return []
    move('/pos/x', bubble.pos.x, dx, 1)
    move('/pos/y', bubble.pos.y, dy, 1)
    if (bubble.tail) {
      move('/tail/x', bubble.tail.x, dx, 1)
      move('/tail/y', bubble.tail.y, dy, 1)
    }
    return patch
  }
  if (selection.kind === 'focus') {
    const at = findFocus(page, selection.id)
    const focus = at?.panel.focusPoints[at.index]
    if (!focus) return []
    return moveFocusPatch(page, focus.id, { x: focus.pos.x + dx, y: focus.pos.y + dy })
  }
  const at = findVector(page, selection.id)
  const vector = at?.panel.vectors[at.index]
  if (!vector) return []
  move('/from/x', vector.from.x, dx, 1)
  move('/from/y', vector.from.y, dy, 1)
  move('/to/x', vector.to.x, dx, 1)
  move('/to/y', vector.to.y, dy, 1)
  return patch
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page

  test('pointerOf addresses panels and bubbles by index, rooted at the page', () => {
    expect(pointerOf(page, { kind: 'panel', id: 'pn_2' })).toBe('/panels/1')
    expect(pointerOf(page, { kind: 'bubble', id: 'bb_3' })).toBe('/panels/2/bubbles/0')
    expect(pointerOf(page, { kind: 'bubble', id: 'nope' })).toBeUndefined()
    expect(pointerOf(page, { kind: 'focus', id: 'x' })).toBeUndefined()
    expect(pointerOf(page, null)).toBeUndefined()
  })

  test('removePatch removes the element', () => {
    expect(removePatch(page, { kind: 'panel', id: 'pn_2' })).toEqual([
      { op: 'remove', path: '/panels/1' },
    ])
    expect(removePatch(page, { kind: 'bubble', id: 'bb_6' })).toEqual([
      { op: 'remove', path: '/panels/5/vectors/0/sourceFocusId' },
      { op: 'remove', path: '/panels/5/bubbles/0' },
    ])
    expect(removePatch(page, null)).toEqual([])
  })

  describe('nudgePatch', () => {
    test('moves a panel and clamps it to the page', () => {
      // pn_2 は x 0.5 w 0.5 なので右へは動けない
      expect(nudgePatch(page, { kind: 'panel', id: 'pn_2' }, 0.01, 0)).toEqual([])
      expect(nudgePatch(page, { kind: 'panel', id: 'pn_2' }, -0.01, 0.01)).toEqual([
        { op: 'replace', path: '/panels/1/rect/x', value: 0.49 },
        { op: 'replace', path: '/panels/1/rect/y', value: 0.285 },
      ])
      expect(nudgePatch(page, { kind: 'panel', id: 'pn_1' }, 0, -0.1)).toEqual([])
    })

    test('moves a bubble with its tail inside the panel', () => {
      expect(nudgePatch(page, { kind: 'bubble', id: 'bb_3' }, 0.01, 0)).toEqual([
        { op: 'replace', path: '/panels/2/bubbles/0/pos/x', value: 0.86 },
        { op: 'replace', path: '/panels/2/bubbles/0/tail/x', value: 0.65 },
      ])
      expect(nudgePatch(page, { kind: 'bubble', id: 'bb_3' }, 0.2, 0)).toEqual([
        { op: 'replace', path: '/panels/2/bubbles/0/pos/x', value: 1 },
        { op: 'replace', path: '/panels/2/bubbles/0/tail/x', value: 0.84 },
      ])
    })

    test('does nothing for a missing element', () => {
      expect(nudgePatch(page, { kind: 'panel', id: 'nope' }, 0.01, 0)).toEqual([])
    })
  })
}
