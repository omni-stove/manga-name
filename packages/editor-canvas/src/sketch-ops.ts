import {
  type Bubble,
  boundsOf,
  containsPoint,
  convexHull,
  createBubble,
  INNER_FRAME,
  innerFrameOf,
  intersectPolygons,
  newId,
  type Page,
  type Panel,
  type Patch,
  panelOutline,
  polygonArea,
  type ReadingDirection,
  type Rect,
  type Size,
} from '@manga/schema'
import { geometryOf, orderOps, renumber } from './panel-ops'

type Point = { x: number; y: number }

/** 閉じた線とみなす始点と終点の距離（mm）。図形の短辺に CLOSE_GAP_RATIO を掛けた長さまでは広げる */
const CLOSE_GAP_MM = 5
const CLOSE_GAP_RATIO = 0.25
/** 短辺がこれ（mm）より小さい図形は、文字の一部とみなして変換しない */
const MIN_SHAPE_MM = 8
/** 頂点を間引くときに許す元の線からのずれ。図形の対角線に対する割合 */
const SIMPLIFY_RATIO = 0.03
/** 間引いた頂点がこの数以下なら角のある図形、つまりコマ */
const MAX_PANEL_VERTICES = 5
/** 外接矩形に対する面積の割合。角が丸く描けた矩形を楕円（π/4 ≈ 0.79）と分ける */
const RECT_FILL = 0.88
/** 縦か横からこの角度（度）以内の辺は、縦か横にそろえる */
const AXIS_DEGREES = 10
/** 頂点を吸い付ける距離（正規化座標）。手描きはぶれるので、コマツールの 0.01 より広く取る */
const SNAP = 0.02
/** 2 つのコマが面で重なったとみなす面積（正規化座標） */
const OVERLAP_AREA = 1e-4

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const round = (v: number) => Math.round(v * 1000) / 1000
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** 開いた折れ線を Ramer–Douglas–Peucker で tolerance 以内に間引く。両端は残す */
function simplifyOpen(pts: readonly Point[], tolerance: number): Point[] {
  const a = pts[0]
  const b = pts.at(-1)
  if (!a || !b || pts.length < 3) return [...pts]
  let index = 0
  let max = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segmentDistance(pts[i] as Point, a, b)
    if (d > max) {
      max = d
      index = i
    }
  }
  if (max <= tolerance) return [a, b]
  return [
    ...simplifyOpen(pts.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplifyOpen(pts.slice(index), tolerance),
  ]
}

/**
 * 閉じた線の角。始点から最も遠い点で 2 本の折れ線に割って間引き、
 * 描き始めが辺の途中だったときに残る、前後の角と一直線に並ぶ頂点も除く
 */
function cornersOf(pts: readonly Point[], tolerance: number): Point[] {
  const start = pts[0] as Point
  let far = 0
  pts.forEach((p, i) => {
    if (distance(p, start) > distance(pts[far] as Point, start)) far = i
  })
  const corners = [
    ...simplifyOpen(pts.slice(0, far + 1), tolerance).slice(0, -1),
    ...simplifyOpen([...pts.slice(far), start], tolerance).slice(0, -1),
  ]
  for (let i = 0; i < corners.length && corners.length > 3; ) {
    const prev = corners[(i + corners.length - 1) % corners.length] as Point
    const next = corners[(i + 1) % corners.length] as Point
    if (segmentDistance(corners[i] as Point, prev, next) <= tolerance) corners.splice(i, 1)
    else i++
  }
  return corners
}

/** 縦か横に近い辺の両端を、x か y の平均にそろえる。点は mm */
function straighten(corners: readonly Point[]): Point[] {
  const out = corners.map((p) => ({ ...p }))
  const limit = Math.tan((AXIS_DEGREES * Math.PI) / 180)
  out.forEach((a, i) => {
    const b = out[(i + 1) % out.length] as Point
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    if (dy <= dx * limit) {
      const y = (a.y + b.y) / 2
      a.y = y
      b.y = y
    } else if (dx <= dy * limit) {
      const x = (a.x + b.x) / 2
      a.x = x
      b.x = x
    }
  })
  return out
}

function snap(v: number, targets: readonly number[]): number {
  let best = v
  let bestDistance = SNAP
  for (const t of targets) {
    const d = Math.abs(t - v)
    if (d <= bestDistance) {
      best = t
      bestDistance = d
    }
  }
  return clamp01(best)
}

/** 下描きの 1 本が表す図形。点と矩形は mm */
type Shape = { kind: 'frame'; corners: Point[]; box: Rect } | { kind: 'oval'; box: Rect }

/** 閉じた線なら角の少ない図形（frame）か丸い図形（oval）。閉じていないか小さすぎれば null */
function shapeOf(pts: readonly Point[]): Shape | null {
  const first = pts[0]
  const last = pts.at(-1)
  if (!first || !last || pts.length < 4) return null
  const box = boundsOf(pts)
  const short = Math.min(box.w, box.h)
  if (short < MIN_SHAPE_MM) return null
  if (distance(first, last) > Math.max(CLOSE_GAP_MM, CLOSE_GAP_RATIO * short)) return null
  const corners = cornersOf(pts, SIMPLIFY_RATIO * Math.hypot(box.w, box.h))
  if (corners.length >= 3 && corners.length <= MAX_PANEL_VERTICES) {
    return { kind: 'frame', corners: straighten(corners), box }
  }
  if (polygonArea(pts) / (box.w * box.h) >= RECT_FILL) {
    return { kind: 'frame', corners: panelOutline({ rect: box }), box }
  }
  return { kind: 'oval', box }
}

const overlaps = (a: readonly Point[], b: readonly Point[]) =>
  polygonArea(intersectPolygons(convexHull(a), convexHull(b))) > OVERLAP_AREA

/** 変換の結果。patch はページを根にしたもの。panels と bubbles は作った数 */
export interface SketchConversion {
  patch: Patch
  panels: number
  bubbles: number
}

/**
 * 下描き（Page.sketch）の閉じた線を、コマとフキダシに変える。
 * 角の少ない図形はコマにし、頂点を内枠、ページの端、他のコマの端へ吸い付け、縦横に近い辺はそろえる。
 * ただし既にあるコマと重なる角の図形は、中心を含むコマのナレーション（四角いフキダシ）にする。
 * 丸い図形は中心を含むコマのフキダシにする。セリフは空のままで、しっぽは付けない。
 * コマを足したら order を読む順に振り直し、フキダシの order はコマ内の既存の次から、rtl なら右上、ltr なら左上から振る。
 * 変換した線は下描きから消し、文字や絵のように閉じていない線、小さい線、どのコマにも入らない図形は残す。
 * pageSize は紙面の大きさ（mm、pageSizeOf）
 */
export function convertSketchPatch(
  page: Page,
  pageSize: Pick<Size, 'w' | 'h'>,
  direction: ReadingDirection,
): SketchConversion {
  const { w, h } = pageSize
  const toUnit = (p: Point): Point => ({ x: p.x / w, y: p.y / h })
  const shapes = (page.sketch ?? [])
    .map((stroke, index) => ({
      index,
      shape: shapeOf(stroke.points.map((p) => ({ x: p.x * w, y: p.y * h }))),
    }))
    .filter((s): s is { index: number; shape: Shape } => s.shape !== null)
    // 外側のコマを先に作り、その中に描いた四角をナレーションとして拾えるようにする
    .sort((a, b) => b.shape.box.w * b.shape.box.h - a.shape.box.w * a.shape.box.h)

  const frame = innerFrameOf(page)
  const xs = [0, 1, frame.x, frame.x + frame.w]
  const ys = [0, 1, frame.y, frame.y + frame.h]
  for (const p of page.panels) {
    xs.push(p.rect.x, p.rect.x + p.rect.w)
    ys.push(p.rect.y, p.rect.y + p.rect.h)
  }
  const added: Panel[] = []
  const converted: number[] = []
  const boxes: { index: number; box: Rect; shape: Bubble['shape'] }[] = []
  for (const { index, shape } of shapes) {
    if (shape.kind === 'oval') {
      boxes.push({ index, box: shape.box, shape: 'normal' })
      continue
    }
    const outline = shape.corners.map((c) => {
      const p = toUnit(c)
      return { x: snap(p.x, xs), y: snap(p.y, ys) }
    })
    if (polygonArea(outline) <= OVERLAP_AREA) continue
    const others = [...page.panels, ...added].map(panelOutline)
    if (others.some((o) => overlaps(outline, o))) {
      boxes.push({ index, box: shape.box, shape: 'narration' })
      continue
    }
    const panel: Panel = {
      id: newId(),
      order: 0,
      ...geometryOf(outline),
      bubbles: [],
      arts: [],
      focusPoints: [],
      vectors: [],
    }
    added.push(panel)
    converted.push(index)
    xs.push(panel.rect.x, panel.rect.x + panel.rect.w)
    ys.push(panel.rect.y, panel.rect.y + panel.rect.h)
  }

  const panels = [...page.panels, ...added]
  const outlines = panels.map(panelOutline)
  const placed = new Map<number, { center: Point; bubble: Bubble }[]>()
  for (const { index, box, shape } of boxes) {
    const center = toUnit({ x: box.x + box.w / 2, y: box.y + box.h / 2 })
    const at = outlines.findIndex((o) => containsPoint(o, center))
    const panel = panels[at]
    if (!panel) continue
    const { rect } = panel
    const bubble = createBubble({
      pos: {
        x: round(clamp01((center.x - rect.x) / rect.w)),
        y: round(clamp01((center.y - rect.y) / rect.h)),
      },
      size: { w: round(clamp01(box.w / w / rect.w)), h: round(clamp01(box.h / h / rect.h)) },
      shape,
    })
    placed.set(at, [...(placed.get(at) ?? []), { center, bubble }])
    converted.push(index)
  }
  const readKey = (p: Point) => (direction === 'rtl' ? 1 - p.x : p.x) + p.y
  const withBubbles = panels.map((panel, i) => {
    const items = placed.get(i)
    if (!items) return panel
    const next = Math.max(0, ...panel.bubbles.map((b) => b.order)) + 1
    const bubbles = items
      .sort((a, b) => readKey(a.center) - readKey(b.center))
      .map(({ bubble }, k) => ({ ...bubble, order: next + k }))
    return { ...panel, bubbles: [...panel.bubbles, ...bubbles] }
  })

  const n = page.panels.length
  // コマを足さないときは、手で入れ替えたかもしれない既存の読み順を崩さない
  const ordered = added.length > 0 ? renumber(withBubbles, direction) : withBubbles
  const patch: Patch = [
    ...orderOps(
      page.panels,
      ordered,
      added.map((_, k) => n + k),
    ),
    ...ordered
      .slice(n)
      .map((value, k) => ({ op: 'add' as const, path: `/panels/${n + k}`, value })),
  ]
  page.panels.forEach((panel, i) => {
    const after = ordered[i] as Panel
    after.bubbles.slice(panel.bubbles.length).forEach((value, k) => {
      patch.push({ op: 'add', path: `/panels/${i}/bubbles/${panel.bubbles.length + k}`, value })
    })
  })
  for (const index of converted.sort((a, b) => b - a)) {
    patch.push({ op: 'remove', path: `/sketch/${index}` })
  }
  return {
    patch,
    panels: added.length,
    bubbles: [...placed.values()].reduce((sum, items) => sum + items.length, 0),
  }
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { createPage, PageSchema } = await import('@manga/schema')

  const SIZE = { w: 182, h: 257 }

  /** mm の頂点を順に結び、始点へ戻る線。手描きのぶれとして辺に垂直な揺れを足す */
  function polygonStroke(corners: Point[], wobble = 0.4) {
    const points: Point[] = []
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % corners.length] as Point
      const len = distance(a, b)
      const steps = Math.max(2, Math.round(len / 2))
      for (let s = 0; s < steps; s++) {
        const t = s / steps
        const off = Math.sin(s * 1.7) * wobble
        points.push({
          x: (a.x + (b.x - a.x) * t + (-(b.y - a.y) / len) * off) / SIZE.w,
          y: (a.y + (b.y - a.y) * t + ((b.x - a.x) / len) * off) / SIZE.h,
        })
      }
    })
    points.push({ x: (corners[0] as Point).x / SIZE.w, y: (corners[0] as Point).y / SIZE.h })
    return { id: newId(), points, width: 0.002, color: 'ink' as const }
  }

  const rectStroke = (x: number, y: number, rw: number, rh: number) =>
    polygonStroke([
      { x, y },
      { x: x + rw, y },
      { x: x + rw, y: y + rh },
      { x, y: y + rh },
    ])

  /** 中心 (cx, cy)、半径 (rx, ry) の楕円（mm） */
  function ovalStroke(cx: number, cy: number, rx: number, ry: number) {
    const points = Array.from({ length: 49 }, (_, i) => {
      const t = (i / 48) * Math.PI * 2
      return { x: (cx + rx * Math.cos(t)) / SIZE.w, y: (cy + ry * Math.sin(t)) / SIZE.h }
    })
    return { id: newId(), points, width: 0.002, color: 'ink' as const }
  }

  /** Patch を当てたページ。ここでは index の add / remove / replace だけを扱う */
  function apply(target: Page, patch: Patch): Page {
    const next = structuredClone(target) as unknown as Record<string, unknown>
    for (const op of patch) {
      const keys = op.path.split('/').slice(1)
      const last = keys.pop() as string
      let parent = next as unknown as Record<string, unknown> | unknown[]
      for (const k of keys) parent = (parent as Record<string, unknown>)[k] as typeof parent
      if (Array.isArray(parent)) {
        const i = Number(last)
        if (op.op === 'add') parent.splice(i, 0, op.value)
        else if (op.op === 'remove') parent.splice(i, 1)
        else parent[i] = op.value
      } else {
        parent[last] = op.value
      }
    }
    return next as unknown as Page
  }

  const convert = (page: Page, direction: ReadingDirection = 'rtl') => {
    const result = convertSketchPatch(page, SIZE, direction)
    const next = apply(page, result.patch)
    expect(PageSchema.safeParse(next).success).toBe(true)
    return { ...result, next }
  }

  // 内枠は x 16..166mm、y 18.5..238.5mm
  const blankWith = (...sketch: Page['sketch'] & object) => ({
    ...createPage('blank', 'rtl'),
    sketch,
  })

  describe('convertSketchPatch', () => {
    test('turns closed boxes into rect panels snapped to the inner frame, in reading order', () => {
      const page = blankWith(rectStroke(17, 20, 72, 100), rectStroke(92, 19, 73, 101))
      const { next, panels, bubbles } = convert(page)
      expect([panels, bubbles]).toEqual([2, 0])
      expect(next.sketch).toEqual([])
      const right = next.panels.find((p) => p.rect.x > 0.5) as Panel
      const left = next.panels.find((p) => p.rect.x < 0.5) as Panel
      expect(right.order).toBe(1)
      expect(left.order).toBe(2)
      expect(right.shape).toBeUndefined()
      expect(left.rect.x).toBeCloseTo(INNER_FRAME.x, 3)
      expect(right.rect.x + right.rect.w).toBeCloseTo(INNER_FRAME.x + INNER_FRAME.w, 2)
      expect(right.rect.y).toBeCloseTo(INNER_FRAME.y, 3)
    })

    test('ltr reads the left panel first', () => {
      const page = blankWith(rectStroke(17, 20, 72, 100), rectStroke(92, 19, 73, 101))
      const { next } = convert(page, 'ltr')
      expect((next.panels.find((p) => p.order === 1) as Panel).rect.x).toBeLessThan(0.5)
    })

    test('keeps a slanted side as a shaped panel', () => {
      const page = blankWith(
        polygonStroke([
          { x: 17, y: 20 },
          { x: 165, y: 20 },
          { x: 165, y: 80 },
          { x: 17, y: 110 },
        ]),
      )
      const { next } = convert(page)
      expect(next.panels[0]?.shape).toHaveLength(4)
    })

    test('turns an oval inside a panel into an empty bubble, right-top first', () => {
      const page = blankWith(
        rectStroke(17, 20, 148, 100),
        ovalStroke(60, 60, 12, 20),
        ovalStroke(140, 50, 10, 18),
      )
      const { next, bubbles } = convert(page)
      expect(bubbles).toBe(2)
      const panel = next.panels[0] as Panel
      const [first, second] = [...panel.bubbles].sort((a, b) => a.order - b.order)
      expect(first?.pos.x).toBeGreaterThan(second?.pos.x ?? 1)
      expect(first).toMatchObject({ text: '', shape: 'normal' })
      expect(first?.tail).toBeUndefined()
      expect((first?.size.w ?? 0) * panel.rect.w * SIZE.w).toBeCloseTo(20, 0)
    })

    test('adds bubbles to existing panels and a box inside one becomes narration', () => {
      const page: Page = {
        ...createPage('2rows', 'rtl'),
        sketch: [ovalStroke(130, 60, 12, 18), rectStroke(30, 30, 30, 12)],
      }
      const before = page.panels.map((p) => p.bubbles.length)
      const { next, panels } = convert(page)
      expect(panels).toBe(0)
      expect(next.panels.map((p) => p.order)).toEqual(page.panels.map((p) => p.order))
      const grown = next.panels.flatMap((p, i) => p.bubbles.slice(before[i]))
      expect(grown.map((b) => b.shape).sort()).toEqual(['narration', 'normal'])
    })

    test('leaves open lines, small marks and shapes outside every panel', () => {
      const line = {
        id: 'open',
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.5, y: 0.3 },
          { x: 0.7, y: 0.25 },
          { x: 0.8, y: 0.6 },
        ],
        width: 0.002,
        color: 'ink' as const,
      }
      const small = { ...ovalStroke(50, 50, 3, 3), id: 'small' }
      const stray = { ...ovalStroke(100, 100, 10, 10), id: 'stray' }
      const { next, patch } = convert(blankWith(line, small, stray))
      expect(next.sketch?.map((s) => s.id)).toEqual(['open', 'small', 'stray'])
      expect(patch).toEqual([])
    })

    test('a page without sketch converts to nothing', () => {
      expect(convertSketchPatch(createPage('blank', 'rtl'), SIZE, 'rtl')).toEqual({
        patch: [],
        panels: 0,
        bubbles: 0,
      })
    })
  })
}
