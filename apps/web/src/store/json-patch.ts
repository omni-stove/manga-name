import type { Patch } from '@manga/schema'
import type { Patch as ImmerPatch } from 'immer'

type Operation = Patch[number]

const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/

/** RFC 6901 の JSON Pointer を参照トークンの列にする。ルート（`""`）は差し替えを許さないので throw する */
function parsePointer(pointer: string): string[] {
  if (!pointer.startsWith('/')) {
    throw new Error(`JSON Pointer must start with "/": ${JSON.stringify(pointer)}`)
  }
  // ~1 を先に戻す。逆順だと "~01" が "/" になる（RFC 6901 §4）
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
}

const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] =>
  typeof v === 'object' && v !== null

/**
 * JSON Patch の 1 操作を、`doc` の現在の形に照らして Immer のパッチに変換する。
 * RFC 6902 が失敗とする操作（存在しないパスの replace / remove、範囲外の添字、値の無い add / replace）は throw する。
 * 配列の `-` は末尾の添字に置き換える。
 */
export function toImmerPatch(doc: unknown, op: Operation): ImmerPatch {
  const tokens = parsePointer(op.path)
  const fail = (reason: string): never => {
    throw new Error(`Cannot ${op.op} ${op.path}: ${reason}`)
  }
  if ((op.op === 'add' || op.op === 'replace') && op.value === undefined) fail('value is missing')

  const path: (string | number)[] = []
  let parent: unknown = doc
  for (const token of tokens.slice(0, -1)) {
    if (!isContainer(parent)) return fail(`/${path.join('/')} is not an object or array`)
    let key: string | number = token
    if (Array.isArray(parent)) {
      key = arrayIndex(parent, token, false, fail)
    } else if (!Object.hasOwn(parent, token)) {
      return fail(`/${[...path, token].join('/')} does not exist`)
    }
    path.push(key)
    parent = (parent as Record<string | number, unknown>)[key]
  }

  const last = tokens.at(-1) ?? ''
  if (!isContainer(parent)) return fail('parent is not an object or array')
  if (Array.isArray(parent)) {
    path.push(arrayIndex(parent, last, op.op === 'add', fail))
  } else {
    if (op.op !== 'add' && !Object.hasOwn(parent, last)) fail('target does not exist')
    path.push(last)
  }
  return op.op === 'remove' ? { op: 'remove', path } : { op: op.op, path, value: op.value }
}

function arrayIndex(
  array: unknown[],
  token: string,
  insert: boolean,
  fail: (reason: string) => never,
): number {
  if (insert && token === '-') return array.length
  if (!ARRAY_INDEX.test(token)) return fail(`"${token}" is not an array index`)
  const index = Number(token)
  if (index > array.length || (!insert && index === array.length)) {
    return fail(`index ${index} is out of range (length ${array.length})`)
  }
  return index
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest

  test('parsePointer unescapes ~1 before ~0', () => {
    expect(parsePointer('/a~1b/c~0d/~01')).toEqual(['a/b', 'c~d', '~1'])
    expect(parsePointer('/')).toEqual([''])
    expect(() => parsePointer('')).toThrow()
    expect(() => parsePointer('title')).toThrow()
  })

  describe('toImmerPatch', () => {
    const doc = { title: 't', pages: [{ id: 'a' }, { id: 'b' }], meta: { note: 'n' } }

    test('converts array tokens to numbers and "-" to the length', () => {
      expect(toImmerPatch(doc, { op: 'replace', path: '/pages/1/id', value: 'c' })).toEqual({
        op: 'replace',
        path: ['pages', 1, 'id'],
        value: 'c',
      })
      expect(toImmerPatch(doc, { op: 'add', path: '/pages/-', value: {} })).toEqual({
        op: 'add',
        path: ['pages', 2],
        value: {},
      })
      expect(toImmerPatch(doc, { op: 'add', path: '/pages/2', value: {} }).path).toEqual([
        'pages',
        2,
      ])
      expect(toImmerPatch(doc, { op: 'remove', path: '/meta/note' })).toEqual({
        op: 'remove',
        path: ['meta', 'note'],
      })
      expect(toImmerPatch(doc, { op: 'add', path: '/meta/camera', value: 'x' }).path).toEqual([
        'meta',
        'camera',
      ])
    })

    test.each([
      [{ op: 'replace', path: '/missing', value: 1 }, 'does not exist'],
      [{ op: 'remove', path: '/missing' }, 'does not exist'],
      [{ op: 'add', path: '/missing/x', value: 1 }, 'does not exist'],
      [{ op: 'replace', path: '/pages/2', value: {} }, 'out of range'],
      [{ op: 'add', path: '/pages/3', value: {} }, 'out of range'],
      [{ op: 'remove', path: '/pages/-' }, 'not an array index'],
      [{ op: 'replace', path: '/pages/01', value: {} }, 'not an array index'],
      [{ op: 'add', path: '/title/x', value: 1 }, 'not an object or array'],
      [{ op: 'replace', path: '/title' }, 'value is missing'],
    ] as const)('rejects %j', (op, message) => {
      expect(() => toImmerPatch(doc, op)).toThrow(message)
    })
  })
}
