import {
  boundsOf,
  clipHalfPlane,
  convexHull,
  fitPanelBubbles,
  type ID,
  intersectPolygons,
  mayOverlap,
  newId,
  type Page,
  type Panel,
  type Patch,
  panelOutline,
  polygonArea,
  type ReadingDirection,
  type Rect,
  type Size,
  type Sweep,
  sideOf,
} from '@manga/schema'

/** コマの端を、他のコマの端とページの端へ吸い付ける距離（正規化座標） */
const SNAP_DISTANCE = 0.01
/** 作成とリサイズで許すコマの最小の幅と高さ */
const MIN_PANEL_SIZE = 0.02
/** 分割で 2 つのコマの間に空ける幅。createPage のコマ間と同じ */
const SPLIT_GUTTER = 0.02
/** 頂点を他のコマの頂点へ吸い付ける距離。辺の吸い付けと同じ */
const VERTEX_SNAP = SNAP_DISTANCE
/** 縦か横からこの角度（度）以内の分割線は、縦か横にそろえる */
const CUT_SNAP_DEGREES = 4
/** 分割線の向きをそろえる先に数える、割るコマからの隙間（正規化座標）。コマ間の SPLIT_GUTTER より広く取る */
const NEIGHBOUR_GAP = 0.05
// 0.51 - 0.5 が 0.010000000000000009 になるので、ちょうど SNAP_DISTANCE の差も吸い付ける
const EPSILON = 1e-9

/** vertical は縦の線で左右に、horizontal は横の線で上下に割る */
export type SplitAxis = 'vertical' | 'horizontal'

/** 正規化座標の 2 点を通る分割線。線は 2 点の外へも伸ばして使う */
export interface Cut {
  from: Point
  to: Point
}

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

const samePoint = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON

/** 重なった頂点と、前後の頂点と一直線に並ぶ頂点を除いた輪郭 */
function simplify(outline: readonly Point[]): Point[] {
  const pts = outline.filter((p, i) => !samePoint(p, outline[(i + 1) % outline.length] as Point))
  return pts.filter((p, i) => {
    const prev = pts[(i + pts.length - 1) % pts.length] as Point
    const next = pts[(i + 1) % pts.length] as Point
    return Math.abs(sideOf(prev, next, p)) > EPSILON
  })
}

/**
 * ページ座標の輪郭を Panel の rect と shape にする。rect は輪郭を囲む矩形で、輪郭がその矩形そのものなら
 * shape を省く。rect は他の操作と同じく 0.001 に丸め、shape は丸めた rect に対するコマ内座標
 */
export function geometryOf(outline: readonly Point[]): { rect: Rect; shape?: Point[] } {
  const pts = simplify(outline)
  const b = boundsOf(pts)
  const rect = rectOf({ left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h })
  const corners = panelOutline({ rect: b })
  const isRect = pts.length === 4 && corners.every((c) => pts.some((p) => samePoint(p, c)))
  if (isRect) return { rect }
  const shape = pts.map((p) => ({
    x: round(clamp01((p.x - rect.x) / rect.w)),
    y: round(clamp01((p.y - rect.y) / rect.h)),
  }))
  return { rect, shape }
}

/** 2 つの輪郭が、辺で接するだけでなく面で重なるか。b は凸包で見るので、凹んだ b では広めに見る */
const outlinesOverlap = (a: readonly Point[], b: readonly Point[]) =>
  polygonArea(intersectPolygons(a, convexHull(b))) > EPSILON

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
  const sign = direction === 'rtl' ? -1 : 1
  const byTop = [...panels].sort((a, b) => a.rect.y - b.rect.y || sign * (a.rect.x - b.rect.x))
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
export function renumber(panels: readonly Panel[], direction: ReadingDirection): Panel[] {
  const rank = new Map(readingOrder(panels, direction).map((p, i) => [p.id, i + 1]))
  return panels.map((p) => ({ ...p, order: rank.get(p.id) ?? p.order }))
}

/** 振り直しで order が変わったコマの replace。skip の添字は丸ごと置き換えるので出さない */
export function orderOps(before: readonly Panel[], after: readonly Panel[], skip: number[]): Patch {
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

/** order の抜けを詰めて 1 から振り直す replace。並び順は変えない。base は配列の JSON Pointer */
export function compactOrderOps(base: string, items: readonly { order: number }[]): Patch {
  const rank = new Map(
    items
      .map((item, i) => ({ order: item.order, i }))
      .sort((a, b) => a.order - b.order || a.i - b.i)
      .map(({ i }, k) => [i, k + 1]),
  )
  return items.flatMap((item, i) => {
    const order = rank.get(i)
    return order === undefined || order === item.order
      ? []
      : [{ op: 'replace' as const, path: `${base}/${i}/order`, value: order }]
  })
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

/**
 * コマ panelId の rect を置き換える Patch。中身はページ上の見た目を保つようにコマ内座標を移し直し、
 * コマ全体を replace する。変わらなければ空
 */
export function resizePanelPatch(page: Page, panelId: ID, rect: Rect): Patch {
  const i = page.panels.findIndex((p) => p.id === panelId)
  const prev = page.panels[i]
  if (!prev) return []
  const same = (['x', 'y', 'w', 'h'] as const).every((k) => prev.rect[k] === rect[k])
  if (same) return []
  const { sweep, ...base } = prev
  const resized: Panel = {
    ...base,
    rect,
    ...contentIn(prev, rect, () => true),
    ...(sweep && { sweep: moveSweep(sweep, prev.rect, rect) }),
  }
  return [{ op: 'replace', path: `/panels/${i}`, value: resized }]
}

/**
 * 縦か横から CUT_SNAP_DEGREES 以内の分割線を、縦か横にそろえた線。角度はページの mm で測るので
 * width と height はページの大きさ（mm）。from は動かさない
 */
export function snapCut(cut: Cut, width: number, height: number): Cut {
  const dx = (cut.to.x - cut.from.x) * width
  const dy = (cut.to.y - cut.from.y) * height
  const degrees = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI
  if (degrees <= CUT_SNAP_DEGREES) return { from: cut.from, to: { x: cut.to.x, y: cut.from.y } }
  if (degrees >= 90 - CUT_SNAP_DEGREES) {
    return { from: cut.from, to: { x: cut.from.x, y: cut.to.y } }
  }
  return cut
}

/**
 * 分割線 cut の向きを、水平と垂直、コマ panelId に隣接するコマの辺の向きのうち最も近いものに固定した線。
 * to はその向きで from を通る直線へ垂直に下ろす。角度はページの mm で測るので width と height は
 * ページの大きさ（mm）。from は動かさない
 */
export function constrainCut(
  page: Page,
  panelId: ID,
  cut: Cut,
  width: number,
  height: number,
): Cut {
  const dx = (cut.to.x - cut.from.x) * width
  const dy = (cut.to.y - cut.from.y) * height
  if (Math.hypot(dx, dy) <= EPSILON) return cut
  const angles = [0, Math.PI / 2]
  const self = page.panels.find((p) => p.id === panelId)
  if (self) {
    const near = edgesOf(self.rect)
    for (const other of page.panels) {
      if (other.id === panelId) continue
      const e = edgesOf(other.rect)
      const apart =
        e.left > near.right + NEIGHBOUR_GAP ||
        e.right < near.left - NEIGHBOUR_GAP ||
        e.top > near.bottom + NEIGHBOUR_GAP ||
        e.bottom < near.top - NEIGHBOUR_GAP
      if (apart) continue
      const outline = panelOutline(other)
      outline.forEach((p, i) => {
        const q = outline[(i + 1) % outline.length] as Point
        angles.push(Math.atan2((q.y - p.y) * height, (q.x - p.x) * width))
      })
    }
  }
  const angle = Math.atan2(dy, dx)
  // 線に向きは無いので、π ずれた角度は同じ向きとして比べる
  const apartFrom = (a: number) => {
    const d = (((angle - a) % Math.PI) + Math.PI) % Math.PI
    return Math.min(d, Math.PI - d)
  }
  const best = angles.reduce((a, b) => (apartFrom(b) < apartFrom(a) ? b : a))
  const ux = Math.cos(best)
  const uy = Math.sin(best)
  const t = dx * ux + dy * uy
  return {
    from: cut.from,
    to: { x: cut.from.x + (t * ux) / width, y: cut.from.y + (t * uy) / height },
  }
}

/**
 * 分割線 cut を伸ばした直線がコマの輪郭を横切る区間の両端（ページ座標）。横切らなければ null。
 * 分割線のプレビューに使う
 */
export function cutChord(panel: Pick<Panel, 'rect' | 'shape'>, cut: Cut): [Point, Point] | null {
  const { from: a, to: b } = cut
  const dx = b.x - a.x
  const dy = b.y - a.y
  const ts: number[] = []
  const outline = panelOutline(panel)
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length] as Point
    const ex = q.x - p.x
    const ey = q.y - p.y
    const denom = dx * ey - dy * ex
    if (Math.abs(denom) <= EPSILON) return
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / denom
    const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / denom
    if (u >= -EPSILON && u <= 1 + EPSILON) ts.push(t)
  })
  if (ts.length < 2) return null
  const lo = Math.min(...ts)
  const hi = Math.max(...ts)
  if (hi - lo <= EPSILON) return null
  const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t })
  return [at(lo), at(hi)]
}

/**
 * コマ panelId を分割線 cut で SPLIT_GUTTER を空けて 2 つに割る Patch。線は 2 点の外へも伸ばし、
 * 斜めの線なら台形や三角形のコマになる。読む順で先に来る半分が元の id、絵の履歴、note と camera を
 * 引き継ぎ、もう一方は新しい空のコマになる。フキダシ、焦点、ベクトルは線のどちら側にあるかで振り分ける。
 * 割った後はページの全コマの order を読む順に振り直す。線がコマを横切らないか、
 * 割った片方が MIN_PANEL_SIZE を下回るなら空
 */
export function cutPanelPatch(
  page: Page,
  panelId: ID,
  cut: Cut,
  direction: ReadingDirection,
): Patch {
  const i = page.panels.findIndex((p) => p.id === panelId)
  const panel = page.panels[i]
  if (!panel || samePoint(cut.from, cut.to)) return []
  const outline = panelOutline(panel)
  const halves = [
    clipHalfPlane(outline, cut.from, cut.to, SPLIT_GUTTER / 2),
    clipHalfPlane(outline, cut.to, cut.from, SPLIT_GUTTER / 2),
  ].map(geometryOf)
  const tooSmall = (g: { rect: Rect }) =>
    g.rect.w < MIN_PANEL_SIZE - EPSILON || g.rect.h < MIN_PANEL_SIZE - EPSILON
  if (halves.some(tooSmall)) return []
  const [firstIndex] = readingOrder(
    halves.map((g, k) => ({ ...g, k })),
    direction,
  ).map((g) => g.k)
  const first = halves[firstIndex as number] as (typeof halves)[number]
  const next = halves[firstIndex === 0 ? 1 : 0] as (typeof halves)[number]
  const r = panel.rect
  const inFirst = (p: Point) => sideOf(cut.from, cut.to, p) >= 0 === (firstIndex === 0)

  const { sweep, shape: _, ...base } = panel
  const kept: Panel = {
    ...base,
    ...first,
    ...contentIn(panel, first.rect, inFirst),
    ...(sweep && { sweep: moveSweep(sweep, r, first.rect) }),
  }
  const added: Panel = {
    id: newId(),
    order: panel.order,
    ...next,
    arts: [],
    ...contentIn(panel, next.rect, (p) => !inFirst(p)),
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

/** コマ panelId を、囲む矩形の中央を通る縦か横の線で割る Patch。cutPanelPatch と同じ規則で割る */
export function splitPanelPatch(
  page: Page,
  panelId: ID,
  axis: SplitAxis,
  direction: ReadingDirection,
): Patch {
  const panel = page.panels.find((p) => p.id === panelId)
  if (!panel) return []
  const r = panel.rect
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const cut: Cut =
    axis === 'vertical'
      ? { from: { x: cx, y: r.y }, to: { x: cx, y: r.y + r.h } }
      : { from: { x: r.x, y: cy }, to: { x: r.x + r.w, y: cy } }
  return cutPanelPatch(page, panelId, cut, direction)
}

/**
 * コマ panelId の輪郭の index 番目の頂点を、正規化座標の点 p へ動かした輪郭（ページ座標）。
 * 頂点は他のコマの頂点へ VERTEX_SNAP 以内なら吸い付け、そうでなければ x と y をそれぞれ
 * 他のコマとページの端へ吸い付ける。ドラッグ中のプレビューにも使う
 */
export function moveVertex(page: Page, panelId: ID, index: number, p: Point): Point[] {
  const panel = page.panels.find((q) => q.id === panelId)
  if (!panel) return []
  const others = page.panels.filter((q) => q.id !== panelId).flatMap(panelOutline)
  const at = { x: clamp01(p.x), y: clamp01(p.y) }
  const near = others
    .map((v) => ({ v, d: Math.hypot(v.x - at.x, v.y - at.y) }))
    .filter(({ d }) => d <= VERTEX_SNAP + EPSILON)
    .sort((a, b) => a.d - b.d)[0]
  const { xs, ys } = snapTargets(page, panelId)
  const moved = near ? near.v : { x: snapValue(at.x, xs), y: snapValue(at.y, ys) }
  return panelOutline(panel).map((v, k) => (k === index ? moved : v))
}

/**
 * コマ panelId の輪郭を outline（ページ座標）に置き換える Patch。rect は輪郭を囲む矩形になり、
 * 中身はページ上の見た目を保つようにコマ内座標を移し直す。囲む矩形が MIN_PANEL_SIZE を下回るか、
 * 面積がほぼ無いか、変わらなければ空
 */
export function reshapePanelPatch(page: Page, panelId: ID, outline: readonly Point[]): Patch {
  const i = page.panels.findIndex((p) => p.id === panelId)
  const prev = page.panels[i]
  if (!prev) return []
  const g = geometryOf(outline)
  if (g.rect.w < MIN_PANEL_SIZE - EPSILON || g.rect.h < MIN_PANEL_SIZE - EPSILON) return []
  if (polygonArea(outline) < MIN_PANEL_SIZE * MIN_PANEL_SIZE) return []
  const { sweep, shape: _, ...base } = prev
  const next: Panel = {
    ...base,
    ...g,
    ...contentIn(prev, g.rect, () => true),
    ...(sweep && { sweep: moveSweep(sweep, prev.rect, g.rect) }),
  }
  if (JSON.stringify(next) === JSON.stringify(prev)) return []
  return [{ op: 'replace', path: `/panels/${i}`, value: next }]
}

/**
 * コマ keepId と otherId を 1 コマにする Patch。2 つとも矩形なら 2 つを囲む矩形、どちらかが多角形なら
 * 2 つの輪郭の凸包にする（斜めに割った 2 コマは元の形に戻る）。keepId の id、note、camera、
 * 採用中の絵を残し、絵の履歴、フキダシ、焦点、ベクトルは両方を移す。otherId のフキダシの order は
 * keepId の後ろに続ける。結合後はページの全コマの order を読む順に振り直す。
 * 枠は keepId のものを残す。結合したコマが、重なってよい組み（mayOverlap）でない他のコマに重なるなら、
 * そのコマを覆ってしまうので空
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
  const corners = [...panelOutline(keep), ...panelOutline(other)]
  const outline =
    keep.shape || other.shape ? convexHull(corners) : panelOutline({ rect: boundsOf(corners) })
  const g = geometryOf(outline)
  const union = g.rect
  const covered = page.panels.some(
    (p) =>
      p.id !== keepId &&
      p.id !== otherId &&
      !mayOverlap(keep, p) &&
      outlinesOverlap(outline, panelOutline(p)),
  )
  if (covered) return []

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
    ...g,
    bubbles: [...ck.bubbles, ...co.bubbles.map((b) => ({ ...b, order: b.order + offset }))],
    focusPoints: [...ck.focusPoints, ...co.focusPoints],
    vectors: [...ck.vectors, ...co.vectors],
    arts: [...keep.arts, ...other.arts],
    ...(artId !== undefined && { artId }),
    ...(note !== undefined && { note }),
    ...(camera !== undefined && { camera }),
    ...(sweep && { sweep }),
    ...(keep.frame && { frame: keep.frame }),
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

/**
 * コマを丸ごと add か replace する patch の、そのコマのフキダシを fitPanelBubbles で枠に収めた patch。
 * pageSize はページの大きさ（mm）。コマの形を変える操作の後に、新しい枠からはみ出たフキダシを戻すのに使う
 */
export function fitBubblesPatch(patch: Patch, pageSize: Pick<Size, 'w' | 'h'>): Patch {
  return patch.map((op) =>
    (op.op === 'add' || op.op === 'replace') && /^\/panels\/\d+$/.test(op.path)
      ? { ...op, value: fitPanelBubbles(op.value as Panel, pageSize) }
      : op,
  )
}

/**
 * コマ panelId のはみ出し（Panel.breakout）を、ページの正規化座標の多角形 polygon にする Patch。
 * 頂点はページの内側に寄せる。頂点が 3 つ未満か面積の無い多角形、ロック中のコマ、無いコマなら空
 */
export function breakoutPatch(page: Page, panelId: ID, polygon: readonly Point[]): Patch {
  const i = page.panels.findIndex((p) => p.id === panelId)
  const panel = page.panels[i]
  if (!panel || panel.locked) return []
  const value = polygon.map((p) => ({ x: round(clamp01(p.x)), y: round(clamp01(p.y)) }))
  if (value.length < 3 || polygonArea(value) <= EPSILON) return []
  return [{ op: panel.breakout ? 'replace' : 'add', path: `/panels/${i}/breakout`, value }]
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { bubbleFits, fixtures, PageSchema } = await import('@manga/schema')
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

  test('resizePanelPatch replaces the panel, or nothing when unchanged', () => {
    const rect = { x: 0.48, y: 0.275, w: 0.52, h: 0.23 }
    expect(resizePanelPatch(page, 'pn_2', rect)).toEqual([
      { op: 'replace', path: '/panels/1', value: expect.objectContaining({ id: 'pn_2', rect }) },
    ])
    expect(resizePanelPatch(page, 'pn_2', (page.panels[1] as Panel).rect)).toEqual([])
    expect(resizePanelPatch(page, 'nope', rect)).toEqual([])
  })

  test('fitBubblesPatch fits the bubbles of whole panels and leaves other operations', () => {
    const pageSize = fixtures.samplePage01.settings.pageSize
    const patch = resizePanelPatch(page, 'pn_3', { x: 0.5, y: 0.3, w: 0.1, h: 0.1 })
    const fitted = fitBubblesPatch(
      [...patch, { op: 'replace', path: '/panels/0/order', value: 1 }],
      pageSize,
    )
    const panel = (fitted[0] as { value: Panel }).value
    expect(panel.rect).toEqual({ x: 0.5, y: 0.3, w: 0.1, h: 0.1 })
    for (const b of panel.bubbles) expect(bubbleFits(b, { panel, pageSize })).toBe(true)
    expect(fitted[1]).toEqual({ op: 'replace', path: '/panels/0/order', value: 1 })
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

  describe('cutPanelPatch', () => {
    // pn_1 は x 0..1, y 0..0.26 の横長のコマ
    const diagonal: Cut = { from: { x: 0.6, y: 0 }, to: { x: 0.4, y: 0.26 } }

    test('a diagonal cut makes two trapezoids with a gutter between them', () => {
      const next = apply(page, cutPanelPatch(page, 'pn_1', diagonal, 'rtl'))
      expect(PageSchema.safeParse(next).success).toBe(true)
      const [right, left] = next.panels as [Panel, Panel]
      // rtl では右の半分が先に読まれ、元の id を引き継ぐ
      expect(right.id).toBe('pn_1')
      expect(left.id).not.toBe('pn_1')
      expect(right.shape).toHaveLength(4)
      expect(left.shape).toHaveLength(4)
      const a = panelOutline(right)
      const b = panelOutline(left)
      expect(polygonArea(intersectPolygons(a, b))).toBe(0)
      // 2 つの間は線に垂直に SPLIT_GUTTER 空く
      const gap = Math.min(...a.map((p) => Math.abs(sideOf(diagonal.from, diagonal.to, p))))
      expect(gap).toBeCloseTo(SPLIT_GUTTER / 2, 2)
      expect(next.panels.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 6, 7])
      // pn_1 の焦点とフキダシは線の右側にある
      expect(right.bubbles.map((x) => x.id)).toEqual(['bb_1'])
    })

    test('cutting a trapezoid again keeps both halves inside it', () => {
      const once = apply(page, cutPanelPatch(page, 'pn_1', diagonal, 'rtl'))
      const right = once.panels[0] as Panel
      const outline = panelOutline(right)
      const twice = apply(once, splitPanelPatch(once, 'pn_1', 'horizontal', 'rtl'))
      expect(PageSchema.safeParse(twice).success).toBe(true)
      const halves = twice.panels.filter(
        (p) => p.id === 'pn_1' || !once.panels.some((q) => q.id === p.id),
      )
      const area = halves.reduce((sum, p) => sum + polygonArea(panelOutline(p)), 0)
      expect(area).toBeLessThan(polygonArea(outline))
      for (const p of halves) {
        for (const v of panelOutline(p)) {
          expect(v.y).toBeGreaterThanOrEqual(outline[0]?.y ?? 0)
        }
      }
    })

    test('does nothing when the line misses the panel or leaves a sliver', () => {
      expect(
        cutPanelPatch(page, 'pn_1', { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } }, 'rtl'),
      ).toEqual([])
      expect(
        cutPanelPatch(page, 'pn_1', { from: { x: 0.005, y: 0 }, to: { x: 0.005, y: 1 } }, 'rtl'),
      ).toEqual([])
      expect(
        cutPanelPatch(page, 'pn_1', { from: diagonal.from, to: diagonal.from }, 'rtl'),
      ).toEqual([])
    })
  })

  test('cutChord spans the panel along the extended line, or is null when it misses', () => {
    const pn1 = page.panels[0] as Panel
    const chord = cutChord(pn1, { from: { x: 0.5, y: 0.1 }, to: { x: 0.5, y: 0.2 } })
    expect(chord?.map((p) => [p.x, Number(p.y.toFixed(3))])).toEqual([
      [0.5, 0],
      [0.5, 0.26],
    ])
    expect(cutChord(pn1, { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } })).toBeNull()
  })

  describe('constrainCut', () => {
    const square: Page = {
      ...page,
      panels: [
        { ...(page.panels[0] as Panel), id: 'pn_a', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
        {
          ...(page.panels[0] as Panel),
          id: 'pn_b',
          // 左の辺が (0.52, 0) から (0.62, 0.5) へ傾いた台形
          rect: { x: 0.52, y: 0, w: 0.48, h: 0.5 },
          shape: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0.1 / 0.48, y: 1 },
          ],
        },
        { ...(page.panels[0] as Panel), id: 'pn_far', rect: { x: 0, y: 0.8, w: 1, h: 0.2 } },
      ],
    }
    const from = { x: 0.2, y: 0 }

    test('locks the line to the slant of a neighbouring edge', () => {
      const cut = constrainCut(square, 'pn_a', { from, to: { x: 0.31, y: 0.5 } }, 100, 100)
      expect(cut.to.x).toBeCloseTo(0.3, 2)
      expect(cut.to.y).toBeCloseTo(0.5, 2)
    })

    test('locks to horizontal or vertical when those are nearer', () => {
      const v = constrainCut(square, 'pn_a', { from, to: { x: 0.23, y: 0.5 } }, 100, 100)
      expect(v.to.x).toBeCloseTo(0.2, 9)
      const h = constrainCut(square, 'pn_a', { from, to: { x: 0.5, y: 0.1 } }, 100, 100)
      expect(h.to.y).toBeCloseTo(0, 9)
    })

    test('ignores panels that are not next to the cut panel', () => {
      const far: Page = {
        ...square,
        panels: square.panels
          .filter((p) => p.id !== 'pn_b')
          .concat({
            ...(square.panels[1] as Panel),
            rect: { x: 0.6, y: 0, w: 0.4, h: 0.5 },
          }),
      }
      const cut = constrainCut(far, 'pn_a', { from, to: { x: 0.31, y: 0.5 } }, 100, 100)
      expect(cut.to.x).toBeCloseTo(0.2, 9)
    })
  })

  test('snapCut straightens nearly vertical and horizontal lines only', () => {
    const from = { x: 0.5, y: 0.1 }
    expect(snapCut({ from, to: { x: 0.505, y: 0.5 } }, 182, 257).to).toEqual({ x: 0.5, y: 0.5 })
    expect(snapCut({ from, to: { x: 0.9, y: 0.11 } }, 182, 257).to).toEqual({ x: 0.9, y: 0.1 })
    expect(snapCut({ from, to: { x: 0.6, y: 0.5 } }, 182, 257).to).toEqual({ x: 0.6, y: 0.5 })
  })

  describe('moveVertex and reshapePanelPatch', () => {
    test('moving a corner turns a rectangle into a quadrilateral and keeps the content in place', () => {
      // pn_1 の左下の頂点（3 番）を右へずらす
      const outline = moveVertex(page, 'pn_1', 3, { x: 0.2, y: 0.26 })
      expect(outline[3]).toEqual({ x: 0.2, y: 0.26 })
      const patch = reshapePanelPatch(page, 'pn_1', outline)
      const next = apply(page, patch)
      expect(PageSchema.safeParse(next).success).toBe(true)
      const pn1 = next.panels[0] as Panel
      expect(pn1.rect).toEqual((page.panels[0] as Panel).rect)
      expect(pn1.shape).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0.2, y: 1 },
      ])
    })

    test('a vertex snaps to a nearby vertex of another panel', () => {
      // pn_2 の左上は (0.5, 0.275)
      expect(moveVertex(page, 'pn_1', 2, { x: 0.505, y: 0.268 })[2]).toEqual({ x: 0.5, y: 0.275 })
    })

    test('moving the vertex back to the corner drops the shape', () => {
      const bent = apply(
        page,
        reshapePanelPatch(page, 'pn_1', moveVertex(page, 'pn_1', 3, { x: 0.2, y: 0.26 })),
      )
      const back = apply(
        bent,
        reshapePanelPatch(bent, 'pn_1', moveVertex(bent, 'pn_1', 3, { x: 0, y: 0.26 })),
      )
      expect(back.panels[0]?.shape).toBeUndefined()
    })

    test('refuses an outline that collapses, and returns nothing when unchanged', () => {
      const pn1 = page.panels[0] as Panel
      const flat = panelOutline(pn1).map((p) => ({ ...p, y: 0 }))
      expect(reshapePanelPatch(page, 'pn_1', flat)).toEqual([])
      expect(reshapePanelPatch(page, 'pn_1', panelOutline(pn1))).toEqual([])
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

    test('merging the two halves of a diagonal cut restores the original panel', () => {
      const cut: Cut = { from: { x: 0.6, y: 0 }, to: { x: 0.4, y: 0.26 } }
      const halves = apply(page, cutPanelPatch(page, 'pn_1', cut, 'rtl'))
      const otherId = halves.panels[1]?.id as ID
      const next = apply(halves, mergePanelsPatch(halves, 'pn_1', otherId, 'rtl'))
      expect(PageSchema.safeParse(next).success).toBe(true)
      expect(next.panels[0]?.rect).toEqual((page.panels[0] as Panel).rect)
      expect(next.panels[0]?.shape).toBeUndefined()
      expect(next.panels).toHaveLength(6)
    })

    test('refuses a merge that would cover another panel', () => {
      expect(mergePanelsPatch(page, 'pn_2', 'pn_6', 'rtl')).toEqual([])
      expect(mergePanelsPatch(page, 'pn_2', 'pn_2', 'rtl')).toEqual([])
      expect(mergePanelsPatch(page, 'pn_2', 'nope', 'rtl')).toEqual([])
    })

    test('merges framed panels laid over a borderless panel, and keeps the frame of keepId', () => {
      const background: Panel = {
        ...(page.panels[0] as Panel),
        id: 'pn_bg',
        order: 7,
        frame: 'none',
        rect: { x: 0, y: 0, w: 1, h: 1 },
      }
      const laid = { ...page, panels: [...page.panels, background] }
      const next = apply(laid, mergePanelsPatch(laid, 'pn_3', 'pn_2', 'rtl'))
      expect(next.panels).toHaveLength(6)
      expect(next.panels.find((p) => p.id === 'pn_3')?.frame).toBeUndefined()

      const borderless = {
        ...page,
        panels: page.panels.map((p) => (p.id === 'pn_3' ? { ...p, frame: 'none' as const } : p)),
      }
      const merged = apply(borderless, mergePanelsPatch(borderless, 'pn_3', 'pn_2', 'rtl'))
      expect(merged.panels.find((p) => p.id === 'pn_3')?.frame).toBe('none')
    })
  })

  describe('breakoutPatch', () => {
    const triangle = [
      { x: 0.6, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.7, y: 0.40000000001 },
    ]

    test('adds the polygon in page coordinates, then replaces it', () => {
      const added = apply(page, breakoutPatch(page, 'pn_2', triangle))
      const pn2 = added.panels.find((p) => p.id === 'pn_2')
      expect(pn2?.breakout).toEqual([
        { x: 0.6, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.7, y: 0.4 },
      ])
      expect(() => PageSchema.parse(added)).not.toThrow()
      const patch = breakoutPatch(added, 'pn_2', [{ x: -0.1, y: 0.1 }, ...triangle.slice(1)])
      expect(patch[0]?.op).toBe('replace')
      expect(apply(added, patch).panels.find((p) => p.id === 'pn_2')?.breakout?.[0]).toEqual({
        x: 0,
        y: 0.1,
      })
    })

    test('is empty for fewer than 3 vertices, a flat polygon and a locked panel', () => {
      expect(breakoutPatch(page, 'pn_2', triangle.slice(0, 2))).toEqual([])
      const flat = [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.1 },
        { x: 0.3, y: 0.1 },
      ]
      expect(breakoutPatch(page, 'pn_2', flat)).toEqual([])
      const locked = { ...page, panels: page.panels.map((p) => ({ ...p, locked: true })) }
      expect(breakoutPatch(locked, 'pn_2', triangle)).toEqual([])
    })
  })
}
