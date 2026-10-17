import {
  type Bubble,
  type BubbleFrame,
  bubbleFits,
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
const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})
const FIT_STEPS = 20

/** frame があり、フキダシが枠からのはみ出しを許していなければ、枠に収めるべき */
const shouldFit = (bubble: Bubble, frame?: BubbleFrame): frame is BubbleFrame =>
  frame !== undefined && bubble.overflow !== true

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
 * コマ panelId のコマ内座標 pos に、createBubble の既定値のフキダシを足す Patch と、その id。
 * order はコマ内の最大の次。pageSize（mm）を渡すとコマの枠に収める。コマが無ければ null
 */
export function createBubblePatch(
  page: Page,
  panelId: ID,
  pos: Point,
  pageSize?: BubbleFrame['pageSize'],
): { patch: Patch; id: ID } | null {
  const i = page.panels.findIndex((p) => p.id === panelId)
  const panel = page.panels[i]
  if (!panel) return null
  const created = createBubble({
    pos: roundPoint(pos),
    order: Math.max(0, ...panel.bubbles.map((b) => b.order)) + 1,
  })
  const bubble = pageSize ? fitBubble(created, { panel, pageSize }) : created
  return {
    patch: [{ op: 'add', path: `/panels/${i}/bubbles/${panel.bubbles.length}`, value: bubble }],
    id: bubble.id,
  }
}

function shifted(bubble: Bubble, dx: number, dy: number): Bubble {
  const moved: Bubble = {
    ...bubble,
    pos: roundPoint({ x: bubble.pos.x + dx, y: bubble.pos.y + dy }),
  }
  if (bubble.tail) moved.tail = roundPoint({ x: bubble.tail.x + dx, y: bubble.tail.y + dy })
  return moved
}

/**
 * フキダシを (dx, dy)（コマ内座標）動かした姿。中心としっぽはコマ内座標の 0..1 に収める。
 * frame を渡すと、overflow でない限り本体を枠に収め、しっぽは本体が実際に動いた分だけ動かす
 */
export function movedBubble(bubble: Bubble, dx: number, dy: number, frame?: BubbleFrame): Bubble {
  const moved = shifted(bubble, dx, dy)
  if (!shouldFit(bubble, frame)) return moved
  const fitted = fitBubble(moved, frame)
  return {
    ...shifted(bubble, fitted.pos.x - bubble.pos.x, fitted.pos.y - bubble.pos.y),
    size: fitted.size,
  }
}

/**
 * ハンドル handle を p（コマ内座標）へ動かした姿。対角の隅を止めたまま外接矩形を張り直す。
 * 幅と高さは MIN_BUBBLE_SIZE 以上 1 以下。frame を渡すと、overflow でない限り、枠に収まる所で
 * ハンドルを止める。元から枠からはみ出していれば、張り直した後に枠に収める
 */
export function resizedBubble(
  bubble: Bubble,
  handle: BubbleHandle,
  p: Point,
  frame?: BubbleFrame,
): Bubble {
  const next = stretched(bubble, handle, p)
  if (!shouldFit(bubble, frame) || bubbleFits(next, frame)) return next
  if (!bubbleFits(bubble, frame)) return fitBubble(next, frame)
  // 止めた隅を動かさないよう、移動や縮小ではなくハンドルを引き戻して収める
  const from = {
    x: bubble.pos.x + (handle.includes('w') ? -1 : 1) * (bubble.size.w / 2),
    y: bubble.pos.y + (handle.includes('n') ? -1 : 1) * (bubble.size.h / 2),
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < FIT_STEPS; i++) {
    const mid = (lo + hi) / 2
    if (bubbleFits(stretched(bubble, handle, lerp(from, p, mid)), frame)) lo = mid
    else hi = mid
  }
  return stretched(bubble, handle, lerp(from, p, lo))
}

function stretched(bubble: Bubble, handle: BubbleHandle, p: Point): Bubble {
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

/** しっぽの先端を p（コマ内座標）に置いた姿。先端はコマ内座標の 0..1 に収める */
export function tailedBubble(bubble: Bubble, p: Point): Bubble {
  return { ...bubble, tail: roundPoint(p) }
}

/**
 * フキダシを next の pos、size、tail に置き換える Patch。変わった値だけ出し、変わらなければ空。
 * しっぽが無かったときは add にする
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
  if (next.tail && (prev.tail?.x !== next.tail.x || prev.tail?.y !== next.tail.y)) {
    patch.push({ op: prev.tail ? 'replace' : 'add', path: `${base}/tail`, value: next.tail })
  }
  return patch
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
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

  test('movedBubble moves the tail along and clamps to the panel', () => {
    const tailed = { ...bubble, tail: { x: 0.5, y: 0.9 } }
    expect(movedBubble(tailed, 0.1, 0.2)).toMatchObject({
      pos: { x: 0.6, y: 0.7 },
      tail: { x: 0.6, y: 1 },
    })
  })

  describe('with a frame', () => {
    // 100mm 四方のコマ。枠から 2mm 空けるので、半径 20mm x 10mm の本体の中心は x 0.22..0.78
    const frame = { panel: { rect: { x: 0, y: 0, w: 1, h: 1 } }, pageSize: { w: 100, h: 100 } }

    test('movedBubble stops the body at the frame and moves the tail only as far', () => {
      const tailed = { ...bubble, tail: { x: 0.5, y: 0.9 } }
      expect(movedBubble(tailed, 0.4, 0, frame)).toMatchObject({
        pos: { x: 0.78, y: 0.5 },
        tail: { x: 0.78, y: 0.9 },
      })
    })

    test('an overflow bubble moves past the frame', () => {
      expect(movedBubble({ ...bubble, overflow: true }, 0.4, 0, frame).pos).toEqual({
        x: 0.9,
        y: 0.5,
      })
    })

    test('resizedBubble holds the opposite corner and stops the handle at the frame', () => {
      const r = resizedBubble(bubble, 'se', { x: 1, y: 0.6 }, frame)
      expect(r.pos.x - r.size.w / 2).toBeCloseTo(0.3)
      expect(r.pos.y - r.size.h / 2).toBeCloseTo(0.4)
      expect(r.pos.x + r.size.w / 2).toBeCloseTo(0.98, 2)
      expect(r.size.h).toBeCloseTo(0.2)
    })

    test('createBubblePatch puts the new bubble inside the panel', () => {
      const pageSize = { w: 182, h: 257 }
      const created = createBubblePatch(page, 'pn_3', { x: 0, y: 0 }, pageSize)
      const value = (created as { patch: { value: Bubble }[] }).patch[0]?.value as Bubble
      expect(value.size).toEqual({ w: 0.3, h: 0.2 })
      expect(bubbleFits(value, { panel: page.panels[2] as Panel, pageSize })).toBe(true)
    })
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
    const { tail: _, ...untailed } = target
    const without: Page = {
      ...page,
      panels: page.panels.map((p, i) => (i === 2 ? { ...p, bubbles: [untailed] } : p)),
    }
    expect(updateBubblePatch(without, tailedBubble(untailed, { x: 0.1, y: 1.5 }))).toEqual([
      { op: 'add', path: '/panels/2/bubbles/0/tail', value: { x: 0.1, y: 1 } },
    ])
  })
}
