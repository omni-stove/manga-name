import type { Episode, ID, Page, ReadingDirection, Size } from './project'

/** 紙面の大きさ（mm）。見開きなら幅を 2 ページ分にする */
export function pageSizeOf<S extends Pick<Size, 'w' | 'h'>>(
  page: Pick<Page, 'spread'>,
  pageSize: S,
): S {
  return page.spread ? { ...pageSize, w: pageSize.w * 2 } : pageSize
}

/** ページが紙面のどこに来るか。見開きは左右の両方を占める */
export type PageSide = 'left' | 'right' | 'spread'

export interface PageSlot {
  page: Page
  /** ノンブル。1 始まりで、見開きは 2 つ使い、その小さい方 */
  number: number
  side: PageSide
}

/** ノンブル number の片ページが左右どちらに来るか。1 ページ目は startsRight でなければ左ページ */
function sideOf(number: number, startsRight: boolean): 'left' | 'right' {
  return (number % 2 === 1) !== startsRight ? 'left' : 'right'
}

/**
 * エピソードのページに、並び順からノンブルと左右を振る。左右を Page に持たないのは、ページの追加や並べ替えの
 * たびに後ろのページを全部書き直すことになるため
 */
export function pageSlots(episode: Pick<Episode, 'pages' | 'startsRight'>): PageSlot[] {
  const startsRight = episode.startsRight === true
  let number = 1
  return episode.pages.map((page) => {
    const slot: PageSlot = {
      page,
      number,
      side: page.spread ? 'spread' : sideOf(number, startsRight),
    }
    number += page.spread ? 2 : 1
    return slot
  })
}

/** ページがめくりの直前か直後か。見開きは両方になりうる */
export interface PageTurn {
  /** 次のページがめくった先にある */
  before: boolean
  /** 前のページからめくって来た */
  after: boolean
}

/**
 * ページごとのめくりの直前・直後。右綴じは左ページ、左綴じは右ページ、見開きはそれ自体がめくりの直前になる。
 * 最後のページはめくる先が無いので直前にせず、最初のページはめくって来ないので直後にしない
 */
export function pageTurns(
  episode: Pick<Episode, 'pages' | 'startsRight'>,
  direction: ReadingDirection,
): Map<ID, PageTurn> {
  const turnSide = direction === 'rtl' ? 'left' : 'right'
  const slots = pageSlots(episode)
  const before = slots.map(
    (s, i) => i < slots.length - 1 && (s.side === 'spread' || s.side === turnSide),
  )
  return new Map(
    slots.map((s, i) => [s.page.id, { before: before[i] === true, after: before[i - 1] === true }]),
  )
}

/** ノンブル number から見開きを始められるか。見開きは右綴じなら右ページ、左綴じなら左ページから始まる */
export function spreadStartsAt(
  number: number,
  startsRight: boolean,
  direction: ReadingDirection,
): boolean {
  return sideOf(number, startsRight) === (direction === 'rtl' ? 'right' : 'left')
}

/**
 * 割れる（ノドで表と裏に分かれる）見開きのページの id。ページの追加、削除、並べ替えと始まりの左右の切り替えは、
 * これを増やさないときだけ許す
 */
export function brokenSpreads(
  episode: Pick<Episode, 'pages' | 'startsRight'>,
  direction: ReadingDirection,
): ID[] {
  const startsRight = episode.startsRight === true
  return pageSlots(episode)
    .filter((s) => s.page.spread && !spreadStartsAt(s.number, startsRight, direction))
    .map((s) => s.page.id)
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const page = (id: string, spread?: true): Page => ({
    id,
    ...(spread && { spread }),
    panels: [],
    scribbles: [],
  })

  test('pageSizeOf doubles the width of a spread', () => {
    const size = { w: 182, h: 257, unit: 'mm' as const }
    expect(pageSizeOf(page('a'), size)).toBe(size)
    expect(pageSizeOf(page('a', true), size)).toEqual({ w: 364, h: 257, unit: 'mm' })
  })

  describe('pageSlots', () => {
    test('starts on the left and a spread takes two numbers', () => {
      const slots = pageSlots({ pages: [page('a'), page('b'), page('c', true), page('d')] })
      expect(slots.map((s) => [s.page.id, s.number, s.side])).toEqual([
        ['a', 1, 'left'],
        ['b', 2, 'right'],
        ['c', 3, 'spread'],
        ['d', 5, 'left'],
      ])
    })

    test('startsRight puts page 1 on the right', () => {
      const slots = pageSlots({ pages: [page('a'), page('b')], startsRight: true })
      expect(slots.map((s) => s.side)).toEqual(['right', 'left'])
    })
  })

  describe('pageTurns', () => {
    const turns = (
      episode: Pick<Episode, 'pages' | 'startsRight'>,
      direction: ReadingDirection,
    ): [string, boolean, boolean][] =>
      [...pageTurns(episode, direction)].map(([id, t]) => [id, t.before, t.after])
    const pages = [page('a'), page('b'), page('c'), page('d')]

    test('rtl turns after each left page', () => {
      expect(turns({ pages }, 'rtl')).toEqual([
        ['a', true, false],
        ['b', false, true],
        ['c', true, false],
        ['d', false, true],
      ])
    })

    test('ltr turns after each right page', () => {
      expect(turns({ pages }, 'ltr')).toEqual([
        ['a', false, false],
        ['b', true, false],
        ['c', false, true],
        ['d', false, false],
      ])
    })

    test('startsRight flips the sides', () => {
      expect(turns({ pages, startsRight: true }, 'rtl')).toEqual([
        ['a', false, false],
        ['b', true, false],
        ['c', false, true],
        ['d', false, false],
      ])
    })

    test('a spread is itself before a turn', () => {
      expect(turns({ pages: [page('a'), page('b', true), page('c')] }, 'rtl')).toEqual([
        ['a', true, false],
        ['b', true, true],
        ['c', false, true],
      ])
    })
  })

  describe('brokenSpreads', () => {
    test('rtl: a spread must start on a right page', () => {
      expect(brokenSpreads({ pages: [page('a'), page('b', true)] }, 'rtl')).toEqual([])
      expect(brokenSpreads({ pages: [page('b', true)] }, 'rtl')).toEqual(['b'])
      expect(brokenSpreads({ pages: [page('b', true)], startsRight: true }, 'rtl')).toEqual([])
      expect(brokenSpreads({ pages: [page('a'), page('b'), page('c', true)] }, 'rtl')).toEqual([
        'c',
      ])
    })

    test('ltr: a spread must start on a left page', () => {
      expect(brokenSpreads({ pages: [page('b', true)] }, 'ltr')).toEqual([])
      expect(brokenSpreads({ pages: [page('a'), page('b', true)] }, 'ltr')).toEqual(['b'])
    })

    test('a spread followed by a spread stays aligned', () => {
      expect(
        brokenSpreads({ pages: [page('a'), page('b', true), page('c', true)] }, 'rtl'),
      ).toEqual([])
    })
  })
}
