import {
  type Bubble,
  type BubbleFrame,
  bubbleGroups,
  createBubble,
  fitBubble,
  type ID,
  type Page,
  type Panel,
  type Patch,
} from '@manga/schema'

/** リサイズで許すフキダシの最小の幅と高さ（コマ内座標） */
const MIN_BUBBLE_SIZE = 0.05

/** リサイズのハンドル。外接矩形の隅の方角 */
export type BubbleHandle = 'ne' | 'nw' | 'se' | 'sw'

type Point = { x: number; y: number }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
// 画面座標からの変換で出る 0.19999999999 のような値を残さない
const round = (v: number) => Math.round(v * 1000) / 1000
const roundPoint = (p: Point): Point => ({ x: round(clamp01(p.x)), y: round(clamp01(p.y)) })

interface Found {
  panel: Panel
  panelIndex: number
  bubble: Bubble
  bubbleIndex: number
}

/** フキダシ bubbleId と、それを持つコマ */
export function findBubble(page: Page, bubbleId: ID): Found | undefined {
  for (const [panelIndex, panel] of page.panels.entries()) {
    const bubbleIndex = panel.bubbles.findIndex((b) => b.id === bubbleId)
    const bubble = panel.bubbles[bubbleIndex]
    if (bubble) return { panel, panelIndex, bubble, bubbleIndex }
  }
  return undefined
}

/**
 * コマ panel のコマ内座標 pos を中心に置く新しいフキダシ。size を省くと createBubble の既定の大きさ。
 * order はコマ内の最大の次。pageSize（mm）を渡すとコマの枠に収める
 */
export function newBubble(
  panel: Panel,
  pos: Point,
  pageSize?: BubbleFrame['pageSize'],
  size?: Bubble['size'],
): Bubble {
  const created = createBubble({
    pos: roundPoint(pos),
    order: Math.max(0, ...panel.bubbles.map((b) => b.order)) + 1,
    ...(size && { size }),
  })
  return pageSize ? fitBubble(created, { panel, pageSize }) : created
}

/**
 * コマ panelId に newBubble を足す Patch と、その id。コマが無ければ null
 */
export function createBubblePatch(
  page: Page,
  panelId: ID,
  pos: Point,
  pageSize?: BubbleFrame['pageSize'],
  size?: Bubble['size'],
): { patch: Patch; id: ID } | null {
  const i = page.panels.findIndex((p) => p.id === panelId)
  const panel = page.panels[i]
  if (!panel) return null
  const bubble = newBubble(panel, pos, pageSize, size)
  return {
    patch: [{ op: 'add', path: `/panels/${i}/bubbles/${panel.bubbles.length}`, value: bubble }],
    id: bubble.id,
  }
}

/**
 * コマ内座標の 2 点 a、b を対角にした外接矩形の中心と大きさ。点はコマ内座標の 0..1 に収め、
 * 幅と高さは MIN_BUBBLE_SIZE 以上
 */
export function spannedRect(a: Point, b: Point): { pos: Point; size: Bubble['size'] } {
  const p = roundPoint(a)
  const q = roundPoint(b)
  return {
    pos: roundPoint({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }),
    size: {
      w: round(Math.max(MIN_BUBBLE_SIZE, Math.abs(p.x - q.x))),
      h: round(Math.max(MIN_BUBBLE_SIZE, Math.abs(p.y - q.y))),
    },
  }
}

/**
 * フキダシを (dx, dy)（コマ内座標）動かした姿。中心としっぽはコマ内座標の 0..1 に収める。
 * 本体は枠に収めない。枠の外に出た部分は、overflow でない限り描画でコマの輪郭に切られる
 */
export function movedBubble(bubble: Bubble, dx: number, dy: number): Bubble {
  const moved: Bubble = {
    ...bubble,
    pos: roundPoint({ x: bubble.pos.x + dx, y: bubble.pos.y + dy }),
  }
  if (bubble.tails) {
    moved.tails = bubble.tails.map((t) => roundPoint({ x: t.x + dx, y: t.y + dy }))
  }
  return moved
}

/**
 * ハンドル handle を p（コマ内座標）へ動かした姿。対角の隅を止めたまま外接矩形を張り直す。
 * 幅と高さは MIN_BUBBLE_SIZE 以上 1 以下。movedBubble と同じく枠には収めない
 */
export function resizedBubble(bubble: Bubble, handle: BubbleHandle, p: Point): Bubble {
  const fixed = {
    x: bubble.pos.x + (handle.includes('w') ? 1 : -1) * (bubble.size.w / 2),
    y: bubble.pos.y + (handle.includes('n') ? 1 : -1) * (bubble.size.h / 2),
  }
  const side = (from: number, to: number, sign: number) => {
    const len = Math.min(1, Math.max(MIN_BUBBLE_SIZE, sign * (to - from)))
    return { len, center: from + (sign * len) / 2 }
  }
  const x = side(fixed.x, p.x, handle.includes('w') ? -1 : 1)
  const y = side(fixed.y, p.y, handle.includes('n') ? -1 : 1)
  return {
    ...bubble,
    pos: roundPoint({ x: x.center, y: y.center }),
    size: { w: round(x.len), h: round(y.len) },
  }
}

/**
 * index 番目のしっぽの先端を p（コマ内座標）に置き、最後に触ったしっぽとして tails の末尾に回した姿。
 * index が無い（tails の長さ以上）ときは新しいしっぽを末尾に足す。先端はコマ内座標の 0..1 に収める
 */
export function tailedBubble(bubble: Bubble, index: number, p: Point): Bubble {
  const rest = (bubble.tails ?? []).filter((_, i) => i !== index)
  return { ...bubble, tails: [...rest, roundPoint(p)] }
}

/** 最後に触ったしっぽ（tails の末尾）を消す Patch。フキダシの root 基準。しっぽが無ければ空 */
export function removeLastTailPatch(bubble: Bubble): Patch {
  const count = bubble.tails?.length ?? 0
  if (count === 0) return []
  // 空の配列を残さず、しっぽの無いフキダシを最初から tails を持たないものと同じ形にする
  return [{ op: 'remove', path: count === 1 ? '/tails' : `/tails/${count - 1}` }]
}

/**
 * フキダシ bubbleId とつなげる、同じコマのフキダシ。order 順。もう同じ組（bubbleGroups）にいるものと、
 * 両方が joinedTo を持っていてどちらにもつなぎ先を足せないものは除く。フキダシが無ければ空
 */
export function joinCandidates(page: Page, bubbleId: ID): Bubble[] {
  const found = findBubble(page, bubbleId)
  if (!found) return []
  const group = bubbleGroups(found.panel.bubbles).find((g) => g.some((b) => b.id === bubbleId))
  const holds = found.bubble.joinedTo !== undefined
  return [...found.panel.bubbles]
    .sort((a, b) => a.order - b.order)
    .filter((b) => !group?.includes(b) && !(holds && b.joinedTo !== undefined))
}

/**
 * フキダシ bubbleId と otherId をつなぐ Patch。ページ root 基準。joinedTo を持たない方に相手の id を持たせ、
 * 両方とも持たなければ bubbleId の方に持たせる。joinCandidates に入らない相手なら空
 */
export function joinBubblesPatch(page: Page, bubbleId: ID, otherId: ID): Patch {
  const found = findBubble(page, bubbleId)
  if (!found || !joinCandidates(page, bubbleId).some((b) => b.id === otherId)) return []
  const holder = found.bubble.joinedTo === undefined ? bubbleId : otherId
  const to = holder === bubbleId ? otherId : bubbleId
  const index = found.panel.bubbles.findIndex((b) => b.id === holder)
  return [{ op: 'add', path: `/panels/${found.panelIndex}/bubbles/${index}/joinedTo`, value: to }]
}

/**
 * フキダシ bubbleId を連結フキダシから切り離す Patch。ページ root 基準。自分の joinedTo と、
 * 自分を指す同じコマのフキダシの joinedTo を外す。つないでいなければ空
 */
export function detachBubblePatch(page: Page, bubbleId: ID): Patch {
  const found = findBubble(page, bubbleId)
  if (!found) return []
  const base = `/panels/${found.panelIndex}/bubbles`
  return found.panel.bubbles.flatMap((b, i): Patch => {
    const joined = b.id === bubbleId ? b.joinedTo !== undefined : b.joinedTo === bubbleId
    return joined ? [{ op: 'remove', path: `${base}/${i}/joinedTo` }] : []
  })
}

const samePoints = (a: readonly Point[] | undefined, b: readonly Point[] | undefined) =>
  (a?.length ?? 0) === (b?.length ?? 0) &&
  (a ?? []).every((p, i) => p.x === b?.[i]?.x && p.y === b?.[i]?.y)

/**
 * フキダシを next の pos、size、tails に置き換える Patch。変わった値だけ出し、変わらなければ空。
 * しっぽは並びも意味を持つので、どれかが変われば tails をまとめて置き換え、無かったときは add にする
 */
export function updateBubblePatch(page: Page, next: Bubble): Patch {
  const found = findBubble(page, next.id)
  if (!found) return []
  const { bubble: prev } = found
  const base = `/panels/${found.panelIndex}/bubbles/${found.bubbleIndex}`
  const patch: Patch = []
  if (prev.pos.x !== next.pos.x || prev.pos.y !== next.pos.y) {
    patch.push({ op: 'replace', path: `${base}/pos`, value: next.pos })
  }
  if (prev.size.w !== next.size.w || prev.size.h !== next.size.h) {
    patch.push({ op: 'replace', path: `${base}/size`, value: next.size })
  }
  if (next.tails && !samePoints(prev.tails, next.tails)) {
    patch.push({ op: prev.tails ? 'replace' : 'add', path: `${base}/tails`, value: next.tails })
  }
  return patch
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { bubbleFits, fixtures } = await import('@manga/schema')
  const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
  const bubble: Bubble = {
    id: 'b',
    order: 1,
    text: '',
    shape: 'normal',
    pos: { x: 0.5, y: 0.5 },
    size: { w: 0.4, h: 0.2 },
  }

  test('findBubble returns the bubble with its indexes', () => {
    expect(findBubble(page, 'bb_3')).toMatchObject({ panelIndex: 2, bubbleIndex: 0 })
    expect(findBubble(page, 'nope')).toBeUndefined()
  })

  test('createBubblePatch adds a default bubble after the largest order of the panel', () => {
    const created = createBubblePatch(page, 'pn_3', { x: 0.25, y: 0.123456 })
    const panel = page.panels[2] as Panel
    expect(created?.patch).toEqual([
      {
        op: 'add',
        path: `/panels/2/bubbles/${panel.bubbles.length}`,
        value: {
          id: created?.id,
          order: Math.max(...panel.bubbles.map((b) => b.order)) + 1,
          text: '',
          shape: 'normal',
          pos: { x: 0.25, y: 0.123 },
          size: { w: 0.3, h: 0.2 },
        },
      },
    ])
    expect(createBubblePatch(page, 'nope', { x: 0, y: 0 })).toBeNull()
  })

  test('movedBubble moves every tail along and clamps to the panel', () => {
    const tailed = {
      ...bubble,
      tails: [
        { x: 0.5, y: 0.9 },
        { x: 0.2, y: 0.1 },
      ],
    }
    expect(movedBubble(tailed, 0.1, 0.2)).toMatchObject({
      pos: { x: 0.6, y: 0.7 },
      tails: [
        { x: 0.6, y: 1 },
        { x: 0.3, y: 0.3 },
      ],
    })
    expect(movedBubble(bubble, 0.1, 0)).not.toHaveProperty('tails')
  })

  test('tailedBubble moves the touched tail to the end, or adds a new one there', () => {
    const tailed = {
      ...bubble,
      tails: [
        { x: 0.1, y: 0.9 },
        { x: 0.9, y: 0.9 },
      ],
    }
    expect(tailedBubble(tailed, 0, { x: 0.2, y: 1.5 }).tails).toEqual([
      { x: 0.9, y: 0.9 },
      { x: 0.2, y: 1 },
    ])
    expect(tailedBubble(tailed, 2, { x: 0.5, y: 0 }).tails).toEqual([
      { x: 0.1, y: 0.9 },
      { x: 0.9, y: 0.9 },
      { x: 0.5, y: 0 },
    ])
    expect(tailedBubble(bubble, 0, { x: 0.5, y: 0.9 }).tails).toEqual([{ x: 0.5, y: 0.9 }])
  })

  test('removeLastTailPatch removes the last tail, and the field with the only one', () => {
    const one = { x: 0.1, y: 0.9 }
    expect(removeLastTailPatch({ ...bubble, tails: [one, one] })).toEqual([
      { op: 'remove', path: '/tails/1' },
    ])
    expect(removeLastTailPatch({ ...bubble, tails: [one] })).toEqual([
      { op: 'remove', path: '/tails' },
    ])
    expect(removeLastTailPatch(bubble)).toEqual([])
    expect(removeLastTailPatch({ ...bubble, tails: [] })).toEqual([])
  })

  describe('joining bubbles', () => {
    // pn_3（3 番目のコマ）に bb_3 の後ろで 3 つ足す。id は他のコマのフキダシ（bb_1 など）と重ねない
    const withBubbles = (...more: Partial<Bubble>[]): Page => ({
      ...page,
      panels: page.panels.map((p) =>
        p.id === 'pn_3'
          ? {
              ...p,
              bubbles: [
                ...p.bubbles,
                ...more.map((b, i) => ({ ...bubble, id: `bj_${i}`, order: i + 2, ...b })),
              ],
            }
          : p,
      ),
    })
    const ids = (bubbles: Bubble[]) => bubbles.map((b) => b.id)

    test('joinCandidates are the other bubbles of the panel not in the same group', () => {
      const three = withBubbles({}, {}, {})
      expect(ids(joinCandidates(three, 'bb_3'))).toEqual(['bj_0', 'bj_1', 'bj_2'])
      const joined = withBubbles({ joinedTo: 'bb_3' }, {}, { joinedTo: 'bj_1' })
      expect(ids(joinCandidates(joined, 'bb_3'))).toEqual(['bj_1', 'bj_2'])
      // bj_0 も bj_2 もつなぎ先を持つので、互いにはつなげない
      expect(ids(joinCandidates(joined, 'bj_0'))).toEqual(['bj_1'])
      expect(joinCandidates(page, 'bb_3')).toEqual([])
      expect(joinCandidates(page, 'nope')).toEqual([])
    })

    test('joinBubblesPatch gives joinedTo to the one without it', () => {
      const three = withBubbles({}, {}, {})
      expect(joinBubblesPatch(three, 'bb_3', 'bj_1')).toEqual([
        { op: 'add', path: '/panels/2/bubbles/0/joinedTo', value: 'bj_1' },
      ])
      const holding = withBubbles({}, { joinedTo: 'bb_3' }, {})
      expect(joinBubblesPatch(holding, 'bj_1', 'bj_2')).toEqual([
        { op: 'add', path: '/panels/2/bubbles/3/joinedTo', value: 'bj_1' },
      ])
      expect(joinBubblesPatch(holding, 'bj_1', 'bb_3')).toEqual([])
      expect(joinBubblesPatch(holding, 'bb_3', 'bb_6')).toEqual([])
    })

    test('detachBubblePatch removes its own joinedTo and those pointing to it', () => {
      const chain = withBubbles({ joinedTo: 'bb_3' }, { joinedTo: 'bj_0' }, { joinedTo: 'bj_0' })
      expect(detachBubblePatch(chain, 'bj_0')).toEqual([
        { op: 'remove', path: '/panels/2/bubbles/1/joinedTo' },
        { op: 'remove', path: '/panels/2/bubbles/2/joinedTo' },
        { op: 'remove', path: '/panels/2/bubbles/3/joinedTo' },
      ])
      expect(detachBubblePatch(chain, 'bb_3')).toEqual([
        { op: 'remove', path: '/panels/2/bubbles/1/joinedTo' },
      ])
      expect(detachBubblePatch(page, 'bb_3')).toEqual([])
    })
  })

  test('movedBubble and resizedBubble go past the frame', () => {
    expect(movedBubble(bubble, 0.4, 0).pos).toEqual({ x: 0.9, y: 0.5 })
    expect(resizedBubble(bubble, 'se', { x: 1, y: 0.6 })).toMatchObject({
      pos: { x: 0.65, y: 0.5 },
      size: { w: 0.7, h: 0.2 },
    })
  })

  test('createBubblePatch takes the size of the new bubble', () => {
    const created = createBubblePatch(page, 'pn_3', { x: 0.5, y: 0.5 }, undefined, {
      w: 0.4,
      h: 0.1,
    })
    expect((created?.patch[0] as { value: Bubble } | undefined)?.value.size).toEqual({
      w: 0.4,
      h: 0.1,
    })
  })

  test('spannedRect spans two corners in any order, inside the panel and at least the minimum size', () => {
    expect(spannedRect({ x: 0.6, y: 0.2 }, { x: 0.2, y: 0.4 })).toEqual({
      pos: { x: 0.4, y: 0.3 },
      size: { w: 0.4, h: 0.2 },
    })
    expect(spannedRect({ x: -0.2, y: 0.5 }, { x: 0.4, y: 0.51 })).toEqual({
      pos: { x: 0.2, y: 0.505 },
      size: { w: 0.4, h: MIN_BUBBLE_SIZE },
    })
  })

  test('createBubblePatch puts the new bubble inside the panel', () => {
    const pageSize = { w: 182, h: 257 }
    const created = createBubblePatch(page, 'pn_3', { x: 0, y: 0 }, pageSize)
    const value = (created as { patch: { value: Bubble }[] }).patch[0]?.value as Bubble
    expect(value.size).toEqual({ w: 0.3, h: 0.2 })
    expect(bubbleFits(value, { panel: page.panels[2] as Panel, pageSize })).toBe(true)
  })

  describe('resizedBubble', () => {
    test('keeps the opposite corner fixed', () => {
      // 元の外接矩形は (0.3, 0.4)-(0.7, 0.6)。se を動かすと nw の (0.3, 0.4) が残る
      expect(resizedBubble(bubble, 'se', { x: 0.9, y: 0.8 })).toMatchObject({
        pos: { x: 0.6, y: 0.6 },
        size: { w: 0.6, h: 0.4 },
      })
      expect(resizedBubble(bubble, 'nw', { x: 0.1, y: 0.2 })).toMatchObject({
        pos: { x: 0.4, y: 0.4 },
        size: { w: 0.6, h: 0.4 },
      })
    })

    test('does not flip or shrink below the minimum', () => {
      expect(resizedBubble(bubble, 'se', { x: 0, y: 0 })).toMatchObject({
        pos: { x: 0.325, y: 0.425 },
        size: { w: 0.05, h: 0.05 },
      })
    })
  })

  test('updateBubblePatch emits only what changed and adds a missing tail', () => {
    const target = findBubble(page, 'bb_3')?.bubble as Bubble
    expect(updateBubblePatch(page, target)).toEqual([])
    expect(updateBubblePatch(page, { ...target, size: { w: 0.5, h: 0.5 } })).toEqual([
      { op: 'replace', path: '/panels/2/bubbles/0/size', value: { w: 0.5, h: 0.5 } },
    ])
    const { tails: _, ...untailed } = target
    const without: Page = {
      ...page,
      panels: page.panels.map((p, i) => (i === 2 ? { ...p, bubbles: [untailed] } : p)),
    }
    expect(updateBubblePatch(without, tailedBubble(untailed, 0, { x: 0.1, y: 1.5 }))).toEqual([
      { op: 'add', path: '/panels/2/bubbles/0/tails', value: [{ x: 0.1, y: 1 }] },
    ])
    expect(updateBubblePatch(page, tailedBubble(target, 1, { x: 0.1, y: 1 }))).toEqual([
      {
        op: 'replace',
        path: '/panels/2/bubbles/0/tails',
        value: [...(target.tails ?? []), { x: 0.1, y: 1 }],
      },
    ])
  })
}
