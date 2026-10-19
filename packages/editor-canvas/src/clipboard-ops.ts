import {
  type Bubble,
  type BubbleFrame,
  type FocusPoint,
  fitBubble,
  type ID,
  newId,
  type Page,
  type Panel,
  type Patch,
  type Point,
  type Rect,
  type Vector,
} from '@manga/schema'
import type { Selection } from './types'

/**
 * コピーした要素。フキダシ、焦点、ベクトルはコマ内座標なので、元のコマの id と rect も持つ。
 * rect は別のコマへ貼ったときにページ上の大きさを保つのに使う。
 * spread はコピー元が見開きか。rect の正規化座標の基準が 1 ページ幅か 2 ページ幅かで変わる
 */
export type CopiedElement =
  | { kind: 'panel'; panel: Panel; spread: boolean }
  | { kind: 'bubble'; bubble: Bubble; panelId: ID; panelRect: Rect; spread: boolean }
  | { kind: 'focus'; focus: FocusPoint; panelId: ID }
  | { kind: 'vector'; vector: Vector; panelId: ID }

/** 貼り付けた要素が同じ位置の要素と重ならないようにずらす量（正規化座標） */
const PASTE_OFFSET = 0.02
/** 重なりを避けてずらす回数の上限。端に詰まって動けなくなっても止まるように */
const MAX_SHIFTS = 20

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const round = (v: number) => Math.round(v * 1000) / 1000

/** 選択要素をコピーしたもの。要素が無ければ null */
export function copyElement(page: Page, selection: Selection): CopiedElement | null {
  if (selection === null) return null
  for (const panel of page.panels) {
    if (selection.kind === 'panel' && panel.id === selection.id) {
      return { kind: 'panel', panel: structuredClone(panel), spread: !!page.spread }
    }
    const at = { panelId: panel.id }
    if (selection.kind === 'bubble') {
      const bubble = panel.bubbles.find((b) => b.id === selection.id)
      if (bubble)
        return {
          kind: 'bubble',
          bubble: structuredClone(bubble),
          ...at,
          panelRect: panel.rect,
          spread: !!page.spread,
        }
    }
    if (selection.kind === 'focus') {
      const focus = panel.focusPoints.find((f) => f.id === selection.id)
      if (focus) return { kind: 'focus', focus: structuredClone(focus), ...at }
    }
    if (selection.kind === 'vector') {
      const vector = panel.vectors.find((v) => v.id === selection.id)
      if (vector) return { kind: 'vector', vector: structuredClone(vector), ...at }
    }
  }
  return null
}

/**
 * (dx, dy) を 0..max に収めて PASTE_OFFSET ずつ増やし、taken でない最初のずらし量。
 * 収まらなくなったら最後に試したもの
 */
function freeShift(
  taken: (dx: number, dy: number) => boolean,
  max: { x: number; y: number; at: Point },
): { dx: number; dy: number } {
  let shift = { dx: 0, dy: 0 }
  for (let i = 0; i <= MAX_SHIFTS; i++) {
    const d = i * PASTE_OFFSET
    shift = {
      dx: round(clamp(max.at.x + d, 0, max.x) - max.at.x),
      dy: round(clamp(max.at.y + d, 0, max.y) - max.at.y),
    }
    if (!taken(shift.dx, shift.dy)) return shift
  }
  return shift
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
const samePoint = (a: Point, b: Point) => near(a.x, b.x) && near(a.y, b.y)
const shifted = (p: Point, dx: number, dy: number): Point => ({
  x: round(clamp(p.x + dx, 0, 1)),
  y: round(clamp(p.y + dy, 0, 1)),
})

/** コピー元の正規化した横幅を貼り先のページの基準に直す倍率 */
const widthScale = (fromSpread: boolean, to: Pick<Page, 'spread'>) =>
  (fromSpread ? 2 : 1) / (to.spread ? 2 : 1)

export interface PasteOptions {
  /** フキダシ、焦点、ベクトルを貼るコマ。無いかページに無ければコピー元のコマ、それも無ければ読み順で最初のコマ */
  panelId?: ID
  /** コピー元と同じプロジェクトか。違えばキャラと絵の参照は指す先が無いので外す */
  sameProject: boolean
  /** ページの大きさ（mm）。別のコマへ貼ったフキダシをその枠に収める */
  pageSize: BubbleFrame['pageSize']
}

/** 別のプロジェクトへ貼るときに外すキャラの参照 */
function withoutCharacters<T extends { speakerId?: ID; characterId?: ID }>(item: T): T {
  const { speakerId: _s, characterId: _c, ...rest } = item
  return rest as T
}

/** 中身ごと新しい id にしたコマ。ベクトルの焦点参照と絵の親子は新しい id に付け替える */
function renewPanel(panel: Panel, sameProject: boolean): Panel {
  const ids = new Map<ID, ID>()
  const renew = (id: ID) => {
    const next = newId()
    ids.set(id, next)
    return next
  }
  const bubbles = panel.bubbles.map((b) => ({
    ...(sameProject ? b : withoutCharacters(b)),
    id: renew(b.id),
  }))
  const focusPoints = panel.focusPoints.map((f) => ({
    ...(sameProject ? f : withoutCharacters(f)),
    id: renew(f.id),
  }))
  const vectors = panel.vectors.map(({ sourceFocusId, targetFocusId, ...v }) => {
    const source = sourceFocusId === undefined ? undefined : ids.get(sourceFocusId)
    const target = targetFocusId === undefined ? undefined : ids.get(targetFocusId)
    return {
      ...v,
      id: newId(),
      ...(source !== undefined && { sourceFocusId: source }),
      ...(target !== undefined && { targetFocusId: target }),
    }
  })
  const { arts, artId, cast, ...rest } = panel
  const base = { ...rest, id: newId(), bubbles, focusPoints, vectors }
  // 絵の ref はプロジェクトのアセットを指すので、別のプロジェクトでは開けない
  if (!sameProject) return { ...base, arts: [] }
  const artIds = new Map(arts.map((a) => [a.id, newId()]))
  return {
    ...base,
    arts: arts.map(({ parentId, ...a }) => ({
      ...a,
      id: artIds.get(a.id) as ID,
      ...(parentId !== undefined && { parentId: artIds.get(parentId) }),
    })),
    ...(artId !== undefined && { artId: artIds.get(artId) }),
    ...(cast && { cast }),
  }
}

/**
 * コピーした要素を新しい id でページに足す Patch と、足した要素の選択。
 * 同じ位置に同じ種類の要素があれば、無い位置まで右下へ PASTE_OFFSET ずつずらす。
 * 位置のロックは外し、order はそれぞれの並びの最大の次にする。ベクトルの焦点参照は貼った先で指す先が無いので外す。
 * フキダシを別のコマへ貼るときはページ上の大きさを保ち、その枠に収める。
 * フキダシ、焦点、ベクトルを貼るコマがページに無ければ null
 */
export function pastePatch(
  page: Page,
  copied: CopiedElement,
  opts: PasteOptions,
): { patch: Patch; selection: NonNullable<Selection> } | null {
  if (copied.kind === 'panel') {
    const { locked: _, ...source } = renewPanel(copied.panel, opts.sameProject)
    // 横の正規化座標は紙面の幅が基準なので、コピー元と貼り先で見開きかどうかが違えば換算する
    const scale = widthScale(copied.spread, page)
    const w = Math.min(1, source.rect.w * scale)
    const rect = { ...source.rect, w, x: Math.min(source.rect.x * scale, 1 - w) }
    // 多角形のコマは輪郭を shape で描くので、rect と同じ換算をかけないと枠と絵がずれる
    const offset = rect.x - source.rect.x * scale
    const shape = source.shape?.map((p) => ({ ...p, x: round(clamp(p.x * scale + offset, 0, 1)) }))
    const { dx, dy } = freeShift(
      (dx, dy) =>
        page.panels.some((p) => near(p.rect.x, rect.x + dx) && near(p.rect.y, rect.y + dy)),
      { x: 1 - rect.w, y: 1 - rect.h, at: rect },
    )
    const panel: Panel = {
      ...source,
      ...(shape && { shape }),
      order: Math.max(0, ...page.panels.map((p) => p.order)) + 1,
      rect: { ...rect, x: round(rect.x + dx), y: round(rect.y + dy) },
    }
    return {
      patch: [{ op: 'add', path: `/panels/${page.panels.length}`, value: panel }],
      selection: { kind: 'panel', id: panel.id },
    }
  }

  const byId = (id: ID | undefined) => page.panels.findIndex((p) => p.id === id)
  const first = page.panels.reduce<number>(
    (best, p, i) => (best < 0 || p.order < (page.panels[best]?.order ?? 0) ? i : best),
    -1,
  )
  const i = [byId(opts.panelId), byId(copied.panelId), first].find((n) => n >= 0) ?? -1
  const panel = page.panels[i]
  if (!panel) return null
  const base = `/panels/${i}`

  if (copied.kind === 'bubble') {
    const { locked: _, ...source } = opts.sameProject
      ? copied.bubble
      : withoutCharacters(copied.bubble)
    const { dx, dy } = freeShift(
      (dx, dy) => panel.bubbles.some((b) => samePoint(b.pos, shifted(source.pos, dx, dy))),
      { x: 1, y: 1, at: source.pos },
    )
    const from = { ...copied.panelRect, w: copied.panelRect.w * widthScale(copied.spread, page) }
    const moved: Bubble = {
      ...source,
      id: newId(),
      order: Math.max(0, ...panel.bubbles.map((b) => b.order)) + 1,
      pos: shifted(source.pos, dx, dy),
      ...(source.tail && { tail: shifted(source.tail, dx, dy) }),
    }
    const samePanel = copied.panelId === panel.id
    const bubble = samePanel
      ? moved
      : fitBubble(
          {
            ...moved,
            size: {
              w: round(Math.min(1, (moved.size.w * from.w) / panel.rect.w)),
              h: round(Math.min(1, (moved.size.h * from.h) / panel.rect.h)),
            },
          },
          { panel, pageSize: opts.pageSize },
        )
    return {
      patch: [{ op: 'add', path: `${base}/bubbles/${panel.bubbles.length}`, value: bubble }],
      selection: { kind: 'bubble', id: bubble.id },
    }
  }

  if (copied.kind === 'focus') {
    const { locked: _, ...source } = opts.sameProject
      ? copied.focus
      : withoutCharacters(copied.focus)
    const { dx, dy } = freeShift(
      (dx, dy) => panel.focusPoints.some((f) => samePoint(f.pos, shifted(source.pos, dx, dy))),
      { x: 1, y: 1, at: source.pos },
    )
    const focus: FocusPoint = { ...source, id: newId(), pos: shifted(source.pos, dx, dy) }
    return {
      patch: [{ op: 'add', path: `${base}/focusPoints/-`, value: focus }],
      selection: { kind: 'focus', id: focus.id },
    }
  }

  const { locked: _, sourceFocusId: _s, targetFocusId: _t, ...source } = copied.vector
  const { dx, dy } = freeShift(
    (dx, dy) => panel.vectors.some((v) => samePoint(v.from, shifted(source.from, dx, dy))),
    { x: 1, y: 1, at: source.from },
  )
  const vector: Vector = {
    ...source,
    id: newId(),
    from: shifted(source.from, dx, dy),
    to: shifted(source.to, dx, dy),
  }
  return {
    patch: [{ op: 'add', path: `${base}/vectors/-`, value: vector }],
    selection: { kind: 'vector', id: vector.id },
  }
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { fixtures, PageSchema } = await import('@manga/schema')
  const project = fixtures.samplePage01
  const page = project.episodes[0]?.pages[0] as Page
  const opts: PasteOptions = { sameProject: true, pageSize: project.settings.pageSize }

  /** 末尾への add だけの Patch を当てたページ */
  function apply(target: Page, patch: Patch): Page {
    const next = structuredClone(target)
    for (const op of patch) {
      if (op.op !== 'add') throw new Error(`unexpected ${op.op}`)
      const keys = op.path.split('/').slice(1)
      keys.pop()
      let parent: unknown = next
      for (const k of keys) parent = (parent as Record<string, unknown>)[k]
      ;(parent as unknown[]).push(op.value)
    }
    return next
  }
  const paste = (copied: CopiedElement, o: Partial<PasteOptions> = {}) => {
    const result = pastePatch(page, copied, { ...opts, ...o })
    if (!result) throw new Error('貼れなかった')
    return { ...result, page: PageSchema.parse(apply(page, result.patch)) }
  }

  test('copyElement copies the selected element with its panel, and null for a missing one', () => {
    expect(copyElement(page, { kind: 'panel', id: 'pn_2' })).toMatchObject({
      kind: 'panel',
      panel: { id: 'pn_2' },
    })
    expect(copyElement(page, { kind: 'bubble', id: 'bb_3' })).toMatchObject({
      kind: 'bubble',
      panelId: 'pn_3',
      bubble: { id: 'bb_3' },
    })
    expect(copyElement(page, { kind: 'bubble', id: 'nope' })).toBeNull()
    expect(copyElement(page, null)).toBeNull()
  })

  describe('pastePatch', () => {
    test('a panel gets new ids throughout, keeps its links and shifts off the original', () => {
      const source = page.panels.find((p) => p.vectors.some((v) => v.sourceFocusId))
      if (!source) throw new Error('fixture に焦点参照のあるベクトルがない')
      const copied = copyElement(page, { kind: 'panel', id: source.id })
      if (!copied) throw new Error('コピーできなかった')
      const { selection, page: next } = paste(copied)
      const pasted = next.panels.at(-1) as Panel
      expect(selection).toEqual({ kind: 'panel', id: pasted.id })
      expect(pasted.id).not.toBe(source.id)
      expect(pasted.order).toBe(Math.max(...page.panels.map((p) => p.order)) + 1)
      expect(pasted.bubbles.map((b) => b.id)).not.toContain(source.bubbles[0]?.id)
      const linked = pasted.vectors.find((v) => v.sourceFocusId)
      expect([...pasted.bubbles, ...pasted.focusPoints].map((e) => e.id)).toContain(
        linked?.sourceFocusId,
      )
      expect(pasted.rect).not.toMatchObject({ x: source.rect.x, y: source.rect.y })
    })

    test('a panel pasted between a single page and a spread keeps its width in mm', () => {
      const source = page.panels[0] as Panel
      const shaped: Panel = {
        ...source,
        rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 },
        shape: [
          { x: 0.1, y: 0.1 },
          { x: 0.5, y: 0.1 },
          { x: 0.1, y: 0.4 },
        ],
      }
      const spread: Page = { ...page, spread: true, panels: [] }
      const result = pastePatch(spread, { kind: 'panel', panel: shaped, spread: false }, opts)
      const pasted = apply(spread, result?.patch ?? []).panels.at(-1) as Panel
      expect(pasted.rect.w).toBeCloseTo(0.2)
      expect(pasted.shape?.map((p) => p.x)).toEqual([0.05, 0.25, 0.05])
      const back = pastePatch(
        { ...page, panels: [] },
        { kind: 'panel', panel: pasted, spread: true },
        opts,
      )
      expect((back?.patch[0]?.value as Panel | undefined)?.rect.w).toBeCloseTo(0.4)
    })

    test('a panel pasted into another project drops its art and character references', () => {
      const source = page.panels.find((p) => p.bubbles.some((b) => b.speakerId))
      if (!source) throw new Error('fixture に話者のあるフキダシがない')
      const copied = copyElement(page, { kind: 'panel', id: source.id })
      if (!copied) throw new Error('コピーできなかった')
      const pasted = paste(copied, { sameProject: false }).page.panels.at(-1) as Panel
      expect(pasted.arts).toEqual([])
      expect(pasted.artId).toBeUndefined()
      expect(pasted.bubbles.every((b) => b.speakerId === undefined)).toBe(true)
    })

    test('a bubble goes into the given panel, unlocked and next in order', () => {
      const bubble = page.panels[2]?.bubbles[0] as Bubble
      const copied: CopiedElement = {
        kind: 'bubble',
        bubble: { ...bubble, locked: true },
        panelId: 'pn_3',
        panelRect: page.panels[2]?.rect as Rect,
        spread: false,
      }
      const same = paste(copied)
      const inSame = same.page.panels[2]?.bubbles.at(-1) as Bubble
      expect(same.selection).toEqual({ kind: 'bubble', id: inSame.id })
      expect(inSame.locked).toBeUndefined()
      expect(inSame.pos).not.toEqual(bubble.pos)
      expect(inSame.size).toEqual(bubble.size)

      const other = paste(copied, { panelId: 'pn_1' })
      expect(other.page.panels[0]?.bubbles.at(-1)?.text).toBe(bubble.text)
    })

    test('a vector drops its focus references and a focus keeps its kind', () => {
      const at = page.panels.findIndex((p) => p.vectors.some((v) => v.sourceFocusId))
      const vector = page.panels[at]?.vectors.find((v) => v.sourceFocusId) as Vector
      const panelId = page.panels[at]?.id as ID
      const pasted = paste({ kind: 'vector', vector, panelId }).page.panels[at]?.vectors.at(-1)
      expect(pasted?.sourceFocusId).toBeUndefined()
      expect(pasted?.from).not.toEqual(vector.from)

      const focus: FocusPoint = {
        id: 'f',
        kind: 'sfx',
        label: 'ドン',
        pos: { x: 1, y: 1 },
        weight: 1,
      }
      const result = paste({ kind: 'focus', focus, panelId: 'pn_1' })
      // 重なる焦点が無ければずらさない
      expect(result.page.panels[0]?.focusPoints.at(-1)).toMatchObject({
        kind: 'sfx',
        pos: focus.pos,
      })
    })

    test('nothing to paste a bubble into on a page without panels', () => {
      const bubble = page.panels[2]?.bubbles[0] as Bubble
      const copied: CopiedElement = {
        kind: 'bubble',
        bubble,
        panelId: 'pn_3',
        panelRect: page.panels[2]?.rect as Rect,
        spread: false,
      }
      expect(pastePatch({ ...page, panels: [] }, copied, opts)).toBeNull()
    })
  })
}
