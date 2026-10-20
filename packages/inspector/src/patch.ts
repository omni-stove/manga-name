import type { ID, PanelActing, Patch } from '@manga/schema'

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

/** コマかページの `cast` に足す。`cast` が無ければ配列ごと add */
export function addCastPatch(cast: readonly ID[] | undefined, id: ID): Patch {
  if (cast === undefined) return [{ op: 'add', path: '/cast', value: [id] }]
  if (cast.includes(id)) return []
  return [{ op: 'add', path: '/cast/-', value: id }]
}

/** コマかページの `cast` から外す。最後の 1 人なら `cast` ごと消す */
export function removeCastPatch(cast: readonly ID[] | undefined, id: ID): Patch {
  const index = cast?.indexOf(id) ?? -1
  if (cast === undefined || index < 0) return []
  return [{ op: 'remove', path: cast.length === 1 ? '/cast' : `/cast/${index}` }]
}

/**
 * コマの `acting` のうち 1 人の芝居を書き換える。空白だけなら要素を消し、最後の 1 つなら `acting` ごと消す。
 * `acting` が無ければ配列ごと add し、同じ値への変更は空
 */
export function actingPatch(
  acting: readonly PanelActing[] | undefined,
  characterId: ID,
  text: string,
): Patch {
  const index = acting?.findIndex((a) => a.characterId === characterId) ?? -1
  if (text.trim() === '') {
    if (acting === undefined || index < 0) return []
    return [{ op: 'remove', path: acting.length === 1 ? '/acting' : `/acting/${index}` }]
  }
  if (acting === undefined) return [{ op: 'add', path: '/acting', value: [{ characterId, text }] }]
  if (index < 0) return [{ op: 'add', path: '/acting/-', value: { characterId, text } }]
  if (acting[index]?.text === text) return []
  return [{ op: 'replace', path: `/acting/${index}/text`, value: text }]
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

  test('addCastPatch creates the array first and skips a character already in it', () => {
    expect(addCastPatch(undefined, 'a')).toEqual([{ op: 'add', path: '/cast', value: ['a'] }])
    expect(addCastPatch(['a'], 'b')).toEqual([{ op: 'add', path: '/cast/-', value: 'b' }])
    expect(addCastPatch(['a'], 'a')).toEqual([])
  })

  test('removeCastPatch removes by index and drops the array with the last character', () => {
    expect(removeCastPatch(['a', 'b'], 'b')).toEqual([{ op: 'remove', path: '/cast/1' }])
    expect(removeCastPatch(['a'], 'a')).toEqual([{ op: 'remove', path: '/cast' }])
    expect(removeCastPatch(['a'], 'b')).toEqual([])
    expect(removeCastPatch(undefined, 'a')).toEqual([])
  })

  test('actingPatch adds, replaces and removes one character and drops the array with the last one', () => {
    const a = { characterId: 'a', text: '驚く' }
    const b = { characterId: 'b', text: '笑う' }
    expect(actingPatch(undefined, 'a', '驚く')).toEqual([
      { op: 'add', path: '/acting', value: [a] },
    ])
    expect(actingPatch([a], 'b', '笑う')).toEqual([{ op: 'add', path: '/acting/-', value: b }])
    expect(actingPatch([a, b], 'b', '泣く')).toEqual([
      { op: 'replace', path: '/acting/1/text', value: '泣く' },
    ])
    expect(actingPatch([a, b], 'b', '笑う')).toEqual([])
    expect(actingPatch([a, b], 'a', ' ')).toEqual([{ op: 'remove', path: '/acting/0' }])
    expect(actingPatch([a], 'a', '')).toEqual([{ op: 'remove', path: '/acting' }])
    expect(actingPatch([a], 'b', '')).toEqual([])
    expect(actingPatch(undefined, 'a', '')).toEqual([])
  })
}
