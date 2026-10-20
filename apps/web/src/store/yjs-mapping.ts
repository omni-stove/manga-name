import type { Patch as ImmerPatch } from 'immer'
import * as Y from 'yjs'

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** JSON 値を Yjs の値にする。オブジェクトは Y.Map、配列は Y.Array、それ以外はそのまま。値が undefined のキーは落とす */
function toY(value: unknown): unknown {
  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>()
    if (value.length > 0) array.insert(0, value.map(toY))
    return array
  }
  if (isPlainObject(value)) {
    const map = new Y.Map<unknown>()
    for (const [key, v] of Object.entries(value)) if (v !== undefined) map.set(key, toY(v))
    return map
  }
  return value
}

/** Yjs の値を JSON 値にする */
function fromY(value: unknown): unknown {
  return value instanceof Y.AbstractType ? value.toJSON() : value
}

/** `value` のキーをすべて `root` に書く。1 つのトランザクションの中で呼ぶ */
export function writeYMap(root: Y.Map<unknown>, value: Record<string, unknown>): void {
  for (const [key, v] of Object.entries(value)) if (v !== undefined) root.set(key, toY(v))
}

/**
 * `root` の JSON 表現 `before` を `after` にする。変わった値だけを書き、同じ長さの配列は要素ごとにたどる。
 * 1 つのトランザクションの中で呼ぶ
 */
export function writeYChanges(
  root: Y.Map<unknown>,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  const write = (
    parent: Y.Map<unknown> | Y.Array<unknown>,
    key: string | number,
    from: unknown,
    to: unknown,
  ) => {
    if (from === to) return
    const current = parent instanceof Y.Map ? parent.get(String(key)) : parent.get(Number(key))
    if (isPlainObject(from) && isPlainObject(to) && current instanceof Y.Map) {
      for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
        if (to[k] === undefined) current.delete(k)
        else write(current, k, from[k], to[k])
      }
    } else if (
      Array.isArray(from) &&
      Array.isArray(to) &&
      from.length === to.length &&
      current instanceof Y.Array
    ) {
      to.forEach((v, i) => {
        write(current, i, from[i], v)
      })
    } else if (parent instanceof Y.Map) {
      parent.set(String(key), toY(to))
    } else {
      parent.delete(Number(key), 1)
      parent.insert(Number(key), [toY(to)])
    }
  }
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (after[k] === undefined) root.delete(k)
    else write(root, k, before[k], after[k])
  }
}

/**
 * 添字が解決済みの Immer パッチ（`toImmerPatch` の出力）を `root` に適用する。トランザクションの中で呼ぶ。
 * 配列要素の replace は削除と挿入にする。同じプリミティブ値への replace は書かない。
 */
export function applyPatchToY(root: Y.Map<unknown>, patch: ImmerPatch): void {
  const fail = (reason: string) =>
    new Error(`Cannot ${patch.op} /${patch.path.join('/')} on Y.Doc: ${reason}`)
  let parent: unknown = root
  for (const key of patch.path.slice(0, -1)) {
    if (parent instanceof Y.Map) parent = parent.get(String(key))
    else if (parent instanceof Y.Array) parent = parent.get(Number(key))
    else throw fail('parent is not a Y.Map or Y.Array')
  }
  const last = patch.path.at(-1)
  if (last === undefined) throw fail('the root cannot be replaced')

  if (parent instanceof Y.Map) {
    const key = String(last)
    if (patch.op === 'remove') parent.delete(key)
    else if (!(patch.op === 'replace' && parent.get(key) === patch.value)) {
      parent.set(key, toY(patch.value))
    }
  } else if (parent instanceof Y.Array) {
    const index = Number(last)
    if (patch.op === 'replace' && parent.get(index) === patch.value) return
    if (patch.op !== 'add') parent.delete(index, 1)
    if (patch.op !== 'remove') parent.insert(index, [toY(patch.value)])
  } else {
    throw fail('parent is not a Y.Map or Y.Array')
  }
}

/**
 * observeDeep に届いたイベントを、観測している型の JSON 表現 `draft`（Immer の draft）に反映する。
 * 変わったキーと配列の範囲だけを書き換えるので、Immer の構造共有が保たれる。
 * observeDeep のコールバックの中で同期的に呼ぶ（Yjs はイベントの changes をその間しか計算できない）。
 */
export function applyYEvents(
  draft: object,
  events: readonly Y.YEvent<Y.AbstractType<unknown>>[],
): void {
  // Yjs は events を path の短い順に渡す。親の配列の挿入と削除を先に反映するので、子の path は変更後の添字で解決できる
  for (const event of events) {
    let target: unknown = draft
    for (const key of event.path) {
      if (typeof target !== 'object' || target === null) {
        throw new Error(`Y event path /${event.path.join('/')} does not exist in the project`)
      }
      target = (target as Record<string | number, unknown>)[key]
    }
    if (event.target instanceof Y.Map && isPlainObject(target)) {
      for (const [key, change] of event.changes.keys) {
        if (change.action === 'delete') delete target[key]
        else target[key] = fromY(event.target.get(key))
      }
    } else if (event.target instanceof Y.Array && Array.isArray(target)) {
      let index = 0
      for (const delta of event.changes.delta) {
        if (delta.retain !== undefined) {
          index += delta.retain
        } else if (delta.delete !== undefined) {
          target.splice(index, delta.delete)
        } else if (Array.isArray(delta.insert)) {
          target.splice(index, 0, ...delta.insert.map(fromY))
          index += delta.insert.length
        }
      }
    } else {
      throw new Error(`Y event at /${event.path.join('/')} does not match the project shape`)
    }
  }
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { produce } = await import('immer')

  const value = { title: 't', pages: [{ id: 'a', tags: ['x'] }], meta: { note: 'n' } }

  test('toY and fromY round-trip JSON values', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<unknown>('root')
    writeYMap(root, { ...value, skipped: undefined })
    expect(root.get('pages')).toBeInstanceOf(Y.Array)
    expect(root.has('skipped')).toBe(false)
    expect(root.toJSON()).toEqual(value)
    expect(fromY(root.get('title'))).toBe('t')
  })

  test('writeYChanges writes only the values that differ', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<unknown>('root')
    writeYMap(root, value)
    const pages = root.get('pages')
    const meta = root.get('meta')
    const after = {
      title: 't',
      pages: [{ id: 'a', tags: ['x'], camera: 'long' }],
      meta: { note: 'n' },
      extra: [1],
    }
    doc.transact(() => writeYChanges(root, value, after))
    expect(root.toJSON()).toEqual(after)
    expect(root.get('pages')).toBe(pages)
    expect(root.get('meta')).toBe(meta)

    doc.transact(() => writeYChanges(root, after, { title: 't', pages: [] }))
    expect(root.toJSON()).toEqual({ title: 't', pages: [] })
  })

  describe('applyPatchToY and applyYEvents', () => {
    const setup = () => {
      const doc = new Y.Doc()
      const root = doc.getMap<unknown>('root')
      writeYMap(root, value)
      let mirror = root.toJSON() as Record<string, unknown>
      root.observeDeep((events) => {
        mirror = produce(mirror, (draft) => applyYEvents(draft, events))
      })
      const apply = (...patches: ImmerPatch[]) =>
        doc.transact(() => {
          for (const p of patches) applyPatchToY(root, p)
        })
      return { root, apply, mirror: () => mirror }
    }

    test('mirror follows map, array and nested changes and keeps untouched parts', () => {
      const { root, apply, mirror } = setup()
      const before = mirror()
      apply(
        { op: 'replace', path: ['title'], value: 'u' },
        { op: 'add', path: ['pages', 0], value: { id: 'z', tags: [] } },
        { op: 'add', path: ['pages', 2], value: { id: 'b', tags: [] } },
        { op: 'replace', path: ['pages', 1, 'id'], value: 'A' },
        { op: 'add', path: ['pages', 1, 'tags', 1], value: 'y' },
        { op: 'remove', path: ['pages', 0] },
      )
      expect(mirror()).toEqual(root.toJSON())
      expect(mirror()).toEqual({
        title: 'u',
        pages: [
          { id: 'A', tags: ['x', 'y'] },
          { id: 'b', tags: [] },
        ],
        meta: { note: 'n' },
      })
      expect(mirror().meta).toBe(before.meta)

      apply(
        { op: 'replace', path: ['pages', 1], value: { id: 'c', tags: ['q'] } },
        { op: 'remove', path: ['meta', 'note'] },
      )
      expect(mirror()).toEqual(root.toJSON())
    })

    test('a replace with the same primitive writes nothing', () => {
      const { root, apply } = setup()
      let updates = 0
      root.doc?.on('update', () => updates++)
      apply({ op: 'replace', path: ['title'], value: 't' })
      apply({ op: 'replace', path: ['pages', 0, 'tags', 0], value: 'x' })
      expect(updates).toBe(0)
    })

    test('a path through a primitive throws', () => {
      const { apply } = setup()
      expect(() => apply({ op: 'replace', path: ['title', 'x'], value: 1 })).toThrow(
        'not a Y.Map or Y.Array',
      )
    })
  })
}
