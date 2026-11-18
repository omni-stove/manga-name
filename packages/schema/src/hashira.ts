import { innerFrameOf } from './factories'
import type { Bubble, Page, ReadingDirection, Rect } from './project'

/** 柱の文字の高さ。1 ページの幅に対する比率で、見開きでも 1 ページ分の幅に対してとる */
export const HASHIRA_FONT = 0.016

/** 柱の書体 */
export const HASHIRA_TYPEFACE: NonNullable<Bubble['typeface']> = 'gothic'

/** 紙面に書く柱の文。前後の空白を除き、空なら undefined */
export function hashiraText(page: Pick<Page, 'hashira'>): string | undefined {
  const text = page.hashira?.trim()
  return text ? text : undefined
}

/**
 * 柱を置く余白。読み終わりの側（右綴じは左、左綴じは右）の、内枠と仕上がり線の間の縦長の範囲で、上下は内枠にそろえる。
 * ページの正規化座標で、見開きなら見開きの紙面に対する座標。柱はこの範囲の中央に縦書きで置く。
 * 片ページでも見開きでも読み終わりの側にするのは、左右のページ（pageSlots）を知らない編集画面と PNG の書き出しでも、
 * PDF と同じ位置に置くため。見開きでは、右綴じなら左ページ、左綴じなら右ページの外側になる
 */
export function hashiraArea(page: Pick<Page, 'spread'>, direction: ReadingDirection): Rect {
  const frame = innerFrameOf(page)
  const margin = frame.x
  return {
    x: direction === 'rtl' ? 0 : frame.x + frame.w,
    y: frame.y,
    w: margin,
    h: frame.h,
  }
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { INNER_FRAME, SPREAD_INNER_FRAME } = await import('./factories')

  describe('hashiraText', () => {
    test('trims the text and drops a blank one', () => {
      expect(hashiraText({ hashira: ' 次号、ついに対決！ ' })).toBe('次号、ついに対決！')
      expect(hashiraText({ hashira: ' \n ' })).toBeUndefined()
      expect(hashiraText({})).toBeUndefined()
    })
  })

  describe('hashiraArea', () => {
    test('a right-bound page puts it in the left margin, a left-bound page in the right one', () => {
      expect(hashiraArea({}, 'rtl')).toEqual({
        x: 0,
        y: INNER_FRAME.y,
        w: INNER_FRAME.x,
        h: INNER_FRAME.h,
      })
      const ltr = hashiraArea({}, 'ltr')
      expect(ltr.x).toBeCloseTo(INNER_FRAME.x + INNER_FRAME.w)
      expect(ltr.x + ltr.w).toBeCloseTo(1)
    })

    test('a spread uses the outer margin of one of its pages', () => {
      const rtl = hashiraArea({ spread: true }, 'rtl')
      expect(rtl).toEqual({
        x: 0,
        y: SPREAD_INNER_FRAME.y,
        w: SPREAD_INNER_FRAME.x,
        h: SPREAD_INNER_FRAME.h,
      })
      const ltr = hashiraArea({ spread: true }, 'ltr')
      expect(ltr.x).toBeCloseTo(SPREAD_INNER_FRAME.x + SPREAD_INNER_FRAME.w)
      expect(ltr.x + ltr.w).toBeCloseTo(1)
    })
  })
}
