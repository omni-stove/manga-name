import {
  type ID,
  newId,
  type Page,
  type Panel,
  type Patch,
  type ReadingDirection,
  type Rect,
  type Sweep,
} from '@manga/schema'

/** コマの端を、他のコマの端とページの端へ吸い付ける距離（正規化座標） */
const SNAP_DISTANCE = 0.01
/** 作成とリサイズで許すコマの最小の幅と高さ */
const MIN_PANEL_SIZE = 0.02
/** 分割で 2 つのコマの間に空ける幅。createPage のコマ間と同じ */
const SPLIT_GUTTER = 0.02
// 0.51 - 0.5 が 0.010000000000000009 になるので、ちょうど SNAP_DISTANCE の差も吸い付ける
const EPSILON = 1e-9

/** vertical は縦の線で左右に、horizontal は横の線で上下に割る */
export type SplitAxis = 'vertical' | 'horizontal'

/** リサイズのハンドル。動かす辺の方角 */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type Point = { x: number; y: number }

interface Edges {
  left: number
  top: number
  right: number
  bottom: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
// 画面座標からの変換で出る 0.19999999999 のような値を残さない
const round = (v: number) => Math.round(v * 1000) / 1000

const edgesOf = (r: Rect): Edges => ({ left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h })

const rectOf = (e: Edges): Rect => {
  const x = round(e.left)
  const y = round(e.top)
  return { x, y, w: round(e.right - x), h: round(e.bottom - y) }
}

/** 0 から 1 の、v に最も近い target。SNAP_DISTANCE より遠ければ v のまま */
function snapValue(v: number, targets: readonly number[]): number {
  let best = v
  let bestDistance = SNAP_DISTANCE + EPSILON
  for (const t of targets) {
    const d = Math.abs(t - v)
    if (d <= bestDistance) {
      best = t
      bestDistance = d
    }
  }
  return clamp01(best)
}

/** 吸い付け先。ページの端と、except 以外のコマの端 */
function snapTargets(page: Page, except?: ID): { xs: number[]; ys: number[] } {
  const xs = [0, 1]
  const ys = [0, 1]
  for (const p of page.panels) {
    if (p.id === except) continue
    xs.push(p.rect.x, p.rect.x + p.rect.w)
    ys.push(p.rect.y, p.rect.y + p.rect.h)
  }
  return { xs, ys }
}

/**
 * 正規化座標の 2 点を対角とする矩形。ページに収め、4 辺とも吸い付ける。
 * 小さすぎるかどうかは見ないので、ドラッグ中のプレビューにも使える
 */
export function draftRect(page: Page, a: Point, b: Point): Rect {
  const { xs, ys } = snapTargets(page)
  const left = snapValue(clamp01(Math.min(a.x, b.x)), xs)
  const right = snapValue(clamp01(Math.max(a.x, b.x)), xs)
  const top = snapValue(clamp01(Math.min(a.y, b.y)), ys)
  const bottom = snapValue(clamp01(Math.max(a.y, b.y)), ys)
  return rectOf({ left, top, right: Math.max(left, right), bottom: Math.max(top, bottom) })
}

/**
 * コマ panelId の handle を正規化座標の点 p へ動かした矩形。動かす辺だけを吸い付け、
 * 反対の辺は固定し、幅と高さは MIN_PANEL_SIZE を下回らない
 */
export function resizeRect(page: Page, panelId: ID, rect: Rect, handle: Handle, p: Point): Rect {
  const { xs, ys } = snapTargets(page, panelId)
  const e = edgesOf(rect)
  const x = snapValue(clamp01(p.x), xs)
  const y = snapValue(clamp01(p.y), ys)
  if (handle.includes('n')) e.top = Math.min(y, e.bottom - MIN_PANEL_SIZE)
  if (handle.includes('s')) e.bottom = Math.max(y, e.top + MIN_PANEL_SIZE)
  if (handle.includes('w')) e.left = Math.min(x, e.right - MIN_PANEL_SIZE)
  if (handle.includes('e')) e.right = Math.max(x, e.left + MIN_PANEL_SIZE)
  return rectOf({
    left: Math.max(0, e.left),
    top: Math.max(0, e.top),
    right: Math.min(1, e.right),
    bottom: Math.min(1, e.bottom),
  })
}

/**
 * 読む順に並べたコマ。上から行に分け、行内は rtl なら右端の大きい順、ltr なら左端の小さい順。
 * 縦の中心が今の行の下端より上にあるコマはその行に入れ、行の下端を広げる。
 * こうすると、行をまたぐ縦長のコマの隣に積んだコマも同じ行として読む
 */
function readingOrder<T extends { rect: Rect }>(
  panels: readonly T[],
  direction: ReadingDirection,
): T[] {
  const rows: { bottom: number; items: T[] }[] = []
  const byTop = [...panels].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
  for (const p of byTop) {
    const row = rows.at(-1)
    const bottom = p.rect.y + p.rect.h
    if (row && p.rect.y + p.rect.h / 2 < row.bottom) {
      row.items.push(p)
      row.bottom = Math.max(row.bottom, bottom)
    } else {
      rows.push({ bottom, items: [p] })
    }
  }
  const inRow =
    direction === 'rtl'
      ? (a: T, b: T) => b.rect.x + b.rect.w - (a.rect.x + a.rect.w) || a.rect.y - b.rect.y
      : (a: T, b: T) => a.rect.x - b.rect.x || a.rect.y - b.rect.y
  return rows.flatMap((row) => row.items.sort(inRow))
}

/** order を読む順の 1 始まりに振り直したコマ。配列の並びは変えない */
function renumber(panels: readonly Panel[], direction: ReadingDirection): Panel[] {
  const rank = new Map(readingOrder(panels, direction).map((p, i) => [p.id, i + 1]))
  return panels.map((p) => ({ ...p, order: rank.get(p.id) ?? p.order }))
}

/** 振り直しで order が変わったコマの replace。skip の添字は丸ごと置き換えるので出さない */
function orderOps(before: readonly Panel[], after: readonly Panel[], skip: number[]): Patch {
  const patch: Patch = []
  after.forEach((p, i) => {
    if (skip.includes(i)) return
    const prev = before.find((q) => q.id === p.id)
    if (prev && prev.order !== p.order) {
      patch.push({ op: 'replace', path: `/panels/${i}/order`, value: p.order })
    }
  })
  return patch
}

/** コマ内座標の点を、コマ from からコマ to のコマ内座標へ移す。to の外は 0..1 に収める */
function movePoint(p: Point, from: Rect, to: Rect): Point {
  return {
    x: round(clamp01((from.x + p.x * from.w - to.x) / to.w)),
    y: round(clamp01((from.y + p.y * from.h - to.y) / to.h)),
  }
}

function moveSweep(sweep: Sweep, from: Rect, to: Rect): Sweep {
  if (sweep.kind === 'centre') {
    return { kind: 'centre', y: movePoint({ x: 0, y: sweep.y }, from, to).y }
  }
  return { kind: 'polyline', points: sweep.points.map((p) => movePoint(p, from, to)) }
}

/**
 * panel の中身のうち、ページ座標の位置で keep を満たすものを to のコマ内座標へ移す。
 * フキダシと焦点は中心、ベクトルは始点で振り分け、フキダシの大きさも to に合わせる。
 * 移した先に無い焦点やフキダシを指すベクトルの参照は外す（PanelSchema が実在を要求する）
 */
function contentIn(panel: Panel, to: Rect, keep: (p: Point) => boolean) {
  const from = panel.rect
  const onPage = (p: Point) => ({ x: from.x + p.x * from.w, y: from.y + p.y * from.h })
  const bubbles = panel.bubbles
    .filter((b) => keep(onPage(b.pos)))
    .map((b) => ({
      ...b,
      pos: movePoint(b.pos, from, to),
      size: {
        w: round(Math.min(1, (b.size.w * from.w) / to.w)),
        h: round(Math.min(1, (b.size.h * from.h) / to.h)),
      },
      ...(b.tail && { tail: movePoint(b.tail, from, to) }),
    }))
  const focusPoints = panel.focusPoints
    .filter((f) => keep(onPage(f.pos)))
    .map((f) => ({ ...f, pos: movePoint(f.pos, from, to) }))
  const ids = new Set<ID>([...bubbles.map((b) => b.id), ...focusPoints.map((f) => f.id)])
  const vectors = panel.vectors
    .filter((v) => keep(onPage(v.from)))
    .map(({ sourceFocusId, targetFocusId, ...v }) => ({
      ...v,
      from: movePoint(v.from, from, to),
      to: movePoint(v.to, from, to),
      ...(sourceFocusId !== undefined && ids.has(sourceFocusId) && { sourceFocusId }),
      ...(targetFocusId !== undefined && ids.has(targetFocusId) && { targetFocusId }),
    }))
  return { bubbles, focusPoints, vectors }
}

const overlaps = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPSILON &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > EPSILON

/**
 * rect の空のコマを足す Patch と、そのコマの id。order は今ある最大の次。
 * 幅か高さが MIN_PANEL_SIZE 未満なら null
 */
export function createPanelPatch(page: Page, rect: Rect): { patch: Patch; id: ID } | null {
  if (rect.w < MIN_PANEL_SIZE - EPSILON || rect.h < MIN_PANEL_SIZE - EPSILON) return null
  const panel: Panel = {
    id: newId(),
    order: Math.max(0, ...page.panels.map((p) => p.order)) + 1,
    rect,
    bubbles: [],
    arts: [],
    focusPoints: [],
    vectors: [],
  }
  return {
    patch: [{ op: 'add', path: `/panels/${page.panels.length}`, value: panel }],
    id: panel.id,
  }
}

/** コマ panelId の rect を置き換える Patch。変わらなければ空 */
export function resizePanelPatch(page: Page, panelId: ID, rect: Rect): Patch {
  const i = page.panels.findIndex((p) => p.id === panelId)
  const prev = page.panels[i]
  if (!prev) return []
  const same = (['x', 'y', 'w', 'h'] as const).every((k) => prev.rect[k] === rect[k])
  return same ? [] : [{ op: 'replace', path: `/panels/${i}/rect`, value: rect }]
}

/**
 * コマ panelId を SPLIT_GUTTER を空けて 2 つに割る Patch。読む順で先に来る半分が元の id、絵の履歴、
 * note と camera を引き継ぎ、もう一方は新しい空のコマになる。フキダシ、焦点、ベクトルは位置で振り分ける。
 * 割った後はページの全コマの order を読む順に振り直す。割ると MIN_PANEL_SIZE を下回るなら空
 */
export function splitPanelPatch(
  page: Page,
  panelId: ID,
  axis: SplitAxis,
  direction: ReadingDirection,
): Patch {
  const i = page.panels.findIndex((p) => p.id === panelId)
  const panel = page.panels[i]
  if (!panel) return []
  const r = panel.rect
  const vertical = axis === 'vertical'
  const length = vertical ? r.w : r.h
  const half = round((length - SPLIT_GUTTER) / 2)
  if (half < MIN_PANEL_SIZE - EPSILON) return []
  const start = vertical ? r.x : r.y
  const second = round(start + half + SPLIT_GUTTER)
  const rest = round(start + length - second)
  const a: Rect = vertical ? { ...r, w: half } : { ...r, h: half }
  const b: Rect = vertical ? { ...r, x: second, w: rest } : { ...r, y: second, h: rest }
  const cut = start + length / 2
  const inA = (p: Point) => (vertical ? p.x : p.y) < cut
  const aFirst = !(vertical && direction === 'rtl')
  const [first, next] = aFirst ? [a, b] : [b, a]
  const inFirst = (p: Point) => inA(p) === aFirst

  const { sweep, ...base } = panel
  const kept: Panel = {
    ...base,
    rect: first,
    ...contentIn(panel, first, inFirst),
    ...(sweep && { sweep: moveSweep(sweep, r, first) }),
  }
  const added: Panel = {
    id: newId(),
    order: panel.order,
    rect: next,
    arts: [],
    ...contentIn(panel, next, (p) => !inFirst(p)),
  }
  const before = [...page.panels]
  before.splice(i, 1, kept, added)
  const after = renumber(before, direction)
  return [
    { op: 'replace', path: `/panels/${i}`, value: after[i] },
    { op: 'add', path: `/panels/${i + 1}`, value: after[i + 1] },
    ...orderOps(before, after, [i, i + 1]),
  ]
}

/**
 * コマ keepId と otherId を、2 つを囲む矩形の 1 コマにする Patch。keepId の id、note、camera、
 * 採用中の絵を残し、絵の履歴、フキダシ、焦点、ベクトルは両方を移す。otherId のフキダシの order は
 * keepId の後ろに続ける。結合後はページの全コマの order を読む順に振り直す。
 * 囲む矩形が他のコマに重なるなら、そのコマを覆ってしまうので空
 */
export function mergePanelsPatch(
  page: Page,
  keepId: ID,
  otherId: ID,
  direction: ReadingDirection,
): Patch {
  if (keepId === otherId) return []
  const i = page.panels.findIndex((p) => p.id === keepId)
  const j = page.panels.findIndex((p) => p.id === otherId)
  const keep = page.panels[i]
  const other = page.panels[j]
  if (!keep || !other) return []
  const ka = edgesOf(keep.rect)
  const kb = edgesOf(other.rect)
  const union = rectOf({
    left: Math.min(ka.left, kb.left),
    top: Math.min(ka.top, kb.top),
    right: Math.max(ka.right, kb.right),
    bottom: Math.max(ka.bottom, kb.bottom),
  })
  if (page.panels.some((p) => p.id !== keepId && p.id !== otherId && overlaps(p.rect, union))) {
    return []
  }

  const all = () => true
  const ck = contentIn(keep, union, all)
  const co = contentIn(other, union, all)
  const offset = Math.max(0, ...keep.bubbles.map((b) => b.order))
  const artId = keep.artId ?? other.artId
  const note = keep.note ?? other.note
  const camera = keep.camera ?? other.camera
  const sweep = keep.sweep
    ? moveSweep(keep.sweep, keep.rect, union)
    : other.sweep && moveSweep(other.sweep, other.rect, union)
  const merged: Panel = {
    id: keep.id,
    order: keep.order,
    rect: union,
    bubbles: [...ck.bubbles, ...co.bubbles.map((b) => ({ ...b, order: b.order + offset }))],
    focusPoints: [...ck.focusPoints, ...co.focusPoints],
    vectors: [...ck.vectors, ...co.vectors],
    arts: [...keep.arts, ...other.arts],
    ...(artId !== undefined && { artId }),
    ...(note !== undefined && { note }),
    ...(camera !== undefined && { camera }),
    ...(sweep && { sweep }),
  }
  const before = page.panels
    .map((p) => (p.id === keepId ? merged : p))
    .filter((p) => p.id !== otherId)
  const after = renumber(before, direction)
  const at = before.findIndex((p) => p.id === keepId)
  return [
    { op: 'replace', path: `/panels/${i}`, value: after[at] },
    { op: 'remove', path: `/panels/${j}` },
    ...orderOps(before, after, [at]),
  ]
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { fixtures, PageSchema } = await import('@manga/schema')
  const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page

  /** Patch を当てたページ。ここでは index の add / remove / replace だけを扱う */
  function apply(target: Page, patch: Patch): Page {
    const next = structuredClone(target) as unknown as Record<string, unknown>
    for (const op of patch) {
      const keys = op.path.split('/').slice(1)
      const last = keys.pop() as string
      let parent = next as unknown as Record<string, unknown> | unknown[]
      for (const k of keys) parent = (parent as Record<string, unknown>)[k] as typeof parent
      if (Array.isArray(parent)) {
        const n = Number(last)
        if (op.op === 'add') parent.splice(n, 0, op.value)
        else if (op.op === 'remove') parent.splice(n, 1)
        else parent[n] = op.value
      } else {
        parent[last] = op.value
      }
    }
    return next as unknown as Page
  }

  describe('snapValue', () => {
    test('snaps within 0.01 and leaves values further away', () => {
      expect(snapValue(0.51, [0.5])).toBe(0.5)
      expect(snapValue(0.49, [0.5])).toBe(0.5)
      expect(snapValue(0.511, [0.5])).toBe(0.511)
      expect(snapValue(0.495, [0.48, 0.5])).toBe(0.5)
    })
  })

  describe('draftRect', () => {
    test('snaps every edge to neighbouring panels and the page, within 0.01', () => {
      // 右端 0.495 は pn_2 の左端 0.5 へ、下端 0.497 は pn_2 / pn_3 の下端 0.505 へ
      expect(draftRect(page, { x: 0.495, y: 0.497 }, { x: 0.2, y: 0.3 })).toEqual({
        x: 0.2,
        y: 0.3,
        w: 0.3,
        h: 0.205,
      })
      expect(draftRect(page, { x: 0.006, y: 0.991 }, { x: 0.3, y: 0.9 })).toEqual({
        x: 0,
        y: 0.9,
        w: 0.3,
        h: 0.1,
      })
      // 0.011 離れていれば吸い付かない
      expect(draftRect(page, { x: 0.511, y: 0.3 }, { x: 0.7, y: 0.4 }).x).toBe(0.511)
    })

    test('stays inside the page', () => {
      expect(draftRect(page, { x: -0.5, y: -0.2 }, { x: 1.4, y: 0.3 })).toEqual({
        x: 0,
        y: 0,
        w: 1,
        h: 0.3,
      })
    })
  })

  describe('resizeRect', () => {
    const pn2 = page.panels[1] as Panel

    test('moves only the dragged edges and snaps them to other panels', () => {
      // pn_3 の右端 0.48 へ吸い付く。自分の左端 0.5 には吸い付かない
      expect(resizeRect(page, 'pn_2', pn2.rect, 'w', { x: 0.485, y: 0.9 })).toEqual({
        x: 0.48,
        y: 0.275,
        w: 0.52,
        h: 0.23,
      })
      // 下端は pn_3 の下端 0.505 より近い pn_4 の上端 0.51 へ
      expect(resizeRect(page, 'pn_2', pn2.rect, 'se', { x: 0.9, y: 0.512 })).toEqual({
        x: 0.5,
        y: 0.275,
        w: 0.4,
        h: 0.235,
      })
    })

    test('keeps the minimum size and the page bounds', () => {
      expect(resizeRect(page, 'pn_2', pn2.rect, 'e', { x: 0.1, y: 0 })).toEqual({
        ...pn2.rect,
        w: 0.02,
      })
      expect(resizeRect(page, 'pn_2', pn2.rect, 'n', { x: 0, y: -1 }).y).toBe(0)
    })
  })

  describe('readingOrder', () => {
    const at = (id: string, x: number, y: number, w: number, h: number) => ({
      id,
      rect: { x, y, w, h },
    })

    test('reads the fixture page right to left, top to bottom', () => {
      expect(readingOrder(page.panels, 'rtl').map((p) => p.id)).toEqual(
        page.panels.map((p) => p.id),
      )
      expect(readingOrder(page.panels, 'ltr').map((p) => p.id)).toEqual([
        'pn_1',
        'pn_3',
        'pn_2',
        'pn_4',
        'pn_6',
        'pn_5',
      ])
    })

    test('panels stacked beside a tall panel belong to its row', () => {
      const panels = [
        at('tall', 0, 0, 0.48, 0.5),
        at('top', 0.5, 0, 0.5, 0.24),
        at('bottom', 0.5, 0.26, 0.5, 0.24),
        at('below', 0, 0.52, 1, 0.48),
      ]
      expect(readingOrder(panels, 'rtl').map((p) => p.id)).toEqual([
        'top',
        'bottom',
        'tall',
        'below',
      ])
    })
  })

  test('createPanelPatch adds one empty panel after the largest order', () => {
    const rect = { x: 0.2, y: 0.3, w: 0.3, h: 0.205 }
    const created = createPanelPatch(page, rect)
    expect(created?.patch).toEqual([
      {
        op: 'add',
        path: '/panels/6',
        value: {
          id: created?.id,
          order: 7,
          rect,
          bubbles: [],
          arts: [],
          focusPoints: [],
          vectors: [],
        },
      },
    ])
    expect(createPanelPatch(page, { ...rect, w: 0.01 })).toBeNull()
  })

  test('resizePanelPatch replaces the rect, or nothing when unchanged', () => {
    const rect = { x: 0.48, y: 0.275, w: 0.52, h: 0.23 }
    expect(resizePanelPatch(page, 'pn_2', rect)).toEqual([
      { op: 'replace', path: '/panels/1/rect', value: rect },
    ])
    expect(resizePanelPatch(page, 'pn_2', (page.panels[1] as Panel).rect)).toEqual([])
    expect(resizePanelPatch(page, 'nope', rect)).toEqual([])
  })

  describe('splitPanelPatch', () => {
    test('a vertical split keeps the id on the right half and renumbers orders rtl', () => {
      const patch = splitPanelPatch(page, 'pn_2', 'vertical', 'rtl')
      const next = apply(page, patch)
      expect(PageSchema.safeParse(next).success).toBe(true)
      expect(next.panels.map((p) => [p.order, p.rect.x, p.rect.w])).toEqual([
        [1, 0, 1],
        [2, 0.76, 0.24],
        [3, 0.5, 0.24],
        [4, 0, 0.48],
        [5, 0, 1],
        [6, 0.5, 0.5],
        [7, 0, 0.48],
      ])
      expect(next.panels[1]?.id).toBe('pn_2')
      expect(next.panels[2]?.id).not.toBe('pn_2')
      expect(patch.slice(2)).toEqual([
        { op: 'replace', path: '/panels/3/order', value: 4 },
        { op: 'replace', path: '/panels/4/order', value: 5 },
        { op: 'replace', path: '/panels/5/order', value: 6 },
        { op: 'replace', path: '/panels/6/order', value: 7 },
      ])
    })

    test('ltr keeps the id on the left half', () => {
      const next = apply(page, splitPanelPatch(page, 'pn_2', 'vertical', 'ltr'))
      const kept = next.panels.find((p) => p.id === 'pn_2')
      expect(kept?.rect.x).toBe(0.5)
    })

    test('a horizontal split moves bubbles, focus points and vectors by position', () => {
      const patch = splitPanelPatch(page, 'pn_6', 'horizontal', 'rtl')
      const next = apply(page, patch)
      expect(PageSchema.safeParse(next).success).toBe(true)
      const top = next.panels[5] as Panel
      const bottom = next.panels[6] as Panel
      expect(top.id).toBe('pn_6')
      expect([top.rect.y, top.rect.h, bottom.rect.y, bottom.rect.h]).toEqual([
        0.835, 0.073, 0.928, 0.072,
      ])
      // bb_6 は中心が上半分（y 0.3）にあるので pn_6 に残り、コマ内座標を詰め直す
      expect(top.bubbles.map((b) => b.id)).toEqual(['bb_6'])
      expect(top.bubbles[0]?.pos.y).toBeCloseTo((0.165 * 0.3) / 0.073, 2)
      expect(bottom.bubbles).toEqual([])
      expect(bottom.arts).toEqual([])
      expect([top.order, bottom.order]).toEqual([6, 7])
      // 振り分け先に無い焦点を指す参照は外す
      for (const panel of [top, bottom]) {
        const ids = new Set([...panel.bubbles, ...panel.focusPoints].map((x) => x.id))
        for (const v of panel.vectors) {
          for (const ref of [v.sourceFocusId, v.targetFocusId]) {
            if (ref !== undefined) expect(ids.has(ref)).toBe(true)
          }
        }
      }
      expect(top.vectors.length + bottom.vectors.length).toBe(2)
    })

    test('does nothing when the halves would be too small or the panel is missing', () => {
      const tiny: Page = {
        ...page,
        panels: [{ ...(page.panels[0] as Panel), rect: { x: 0, y: 0, w: 0.05, h: 0.5 } }],
      }
      expect(splitPanelPatch(tiny, 'pn_1', 'vertical', 'rtl')).toEqual([])
      expect(splitPanelPatch(page, 'nope', 'vertical', 'rtl')).toEqual([])
    })
  })

  describe('mergePanelsPatch', () => {
    test('merges two panels into their bounding box and renumbers', () => {
      const patch = mergePanelsPatch(page, 'pn_3', 'pn_2', 'rtl')
      const next = apply(page, patch)
      expect(PageSchema.safeParse(next).success).toBe(true)
      expect(patch.slice(0, 2).map((op) => [op.op, op.path])).toEqual([
        ['replace', '/panels/2'],
        ['remove', '/panels/1'],
      ])
      expect(next.panels.map((p) => [p.id, p.order])).toEqual([
        ['pn_1', 1],
        ['pn_3', 2],
        ['pn_4', 3],
        ['pn_5', 4],
        ['pn_6', 5],
      ])
      const merged = next.panels[1] as Panel
      expect(merged.rect).toEqual({ x: 0, y: 0.275, w: 1, h: 0.23 })
      expect(merged.focusPoints.map((f) => f.id)).toEqual(['fp_3_e', 'fp_2_e', 'fp_2_vial'])
      // bb_3 は pn_3 のページ上の位置のまま
      expect(merged.bubbles[0]?.pos.x).toBeCloseTo(0.85 * 0.48, 3)
      expect(merged.bubbles[0]?.size.w).toBeCloseTo(0.22 * 0.48, 3)
    })

    test('continues bubble orders after the kept panel', () => {
      const bb6 = (page.panels[5] as Panel).bubbles[0] as Panel['bubbles'][number]
      const withBubble: Page = {
        ...page,
        panels: page.panels.map((p) =>
          p.id === 'pn_5' ? { ...p, bubbles: [{ ...bb6, id: 'bb_5' }] } : p,
        ),
      }
      const next = apply(withBubble, mergePanelsPatch(withBubble, 'pn_5', 'pn_6', 'rtl'))
      expect(PageSchema.safeParse(next).success).toBe(true)
      expect(next.panels[4]?.bubbles.map((b) => [b.id, b.order])).toEqual([
        ['bb_5', 1],
        ['bb_6', 2],
      ])
    })

    test('refuses a merge that would cover another panel', () => {
      expect(mergePanelsPatch(page, 'pn_2', 'pn_6', 'rtl')).toEqual([])
      expect(mergePanelsPatch(page, 'pn_2', 'pn_2', 'rtl')).toEqual([])
      expect(mergePanelsPatch(page, 'pn_2', 'nope', 'rtl')).toEqual([])
    })
  })
}
