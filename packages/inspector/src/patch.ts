import type { Patch } from '@manga/schema'

export const replace = (path: string, value: unknown): Patch => [{ op: 'replace', path, value }]

/**
 * 任意の文字列項目の Patch。空文字は項目を持たない形にする。
 * 無い項目を空にする Patch は空で、同じ値への変更も空
 */
export function optionalString(path: string, current: string | undefined, next: string): Patch {
  if (next === '') return current === undefined ? [] : [{ op: 'remove', path }]
  if (next === current) return []
  // JSON Patch の add は既存のメンバーを置き換えるので、有無を分けずに済む
  return [{ op: 'add', path, value: next }]
}

/** 2 つの要素の order を入れ替える Patch。配列内の添字を path に使う */
export function swapOrder(
  base: string,
  a: { index: number; order: number },
  b: { index: number; order: number },
): Patch {
  return [
    { op: 'replace', path: `${base}/${a.index}/order`, value: b.order },
    { op: 'replace', path: `${base}/${b.index}/order`, value: a.order },
  ]
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest

  test('optionalString removes on empty, adds otherwise, and is empty when nothing changes', () => {
    expect(optionalString('/note', undefined, '')).toEqual([])
    expect(optionalString('/note', 'a', '')).toEqual([{ op: 'remove', path: '/note' }])
    expect(optionalString('/note', 'a', 'a')).toEqual([])
    expect(optionalString('/note', undefined, 'b')).toEqual([
      { op: 'add', path: '/note', value: 'b' },
    ])
  })

  test('swapOrder exchanges the two orders by index', () => {
    expect(swapOrder('/bubbles', { index: 2, order: 1 }, { index: 0, order: 3 })).toEqual([
      { op: 'replace', path: '/bubbles/2/order', value: 3 },
      { op: 'replace', path: '/bubbles/0/order', value: 1 },
    ])
  })
}
