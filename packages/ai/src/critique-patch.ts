import { type Page, type Patch, PointSchema, VectorSchema } from '@manga/schema'

/**
 * critique の提案 Patch を適用できない理由。`path` はページを根にしたパス。
 * 利用者に見せる文言は、このパッケージを使う画面が `code` から作る
 */
export type CritiquePatchRejection =
  | { code: 'rect' | 'empty' | 'vector_add_only' }
  | {
      code:
        | 'replace_only'
        | 'missing_item'
        | 'locked'
        | 'not_point'
        | 'missing_panel'
        | 'index_out_of_range'
        | 'not_vector'
      path: string
    }
  | { code: 'vector_id_taken' | 'vector_endpoint'; id: string }
  | { code: 'not_allowed'; op: string; path: string }

/** critique の提案 Patch の検査結果。`ok` なら `patch` はページを根にしたパスに直したもの */
export type CritiquePatchCheck =
  | { ok: true; patch: Patch }
  | { ok: false; rejection: CritiquePatchRejection }

/** Project を根にしたパスの、ページまでの接頭辞。LLM がプロジェクト根で返しても受け付ける */
const PAGE_PREFIX = /^\/episodes\/\d+\/pages\/\d+(?=\/)/
const POS_PATH = /^\/panels\/(\d+)\/(focusPoints|bubbles)\/(\d+)\/pos$/
const VECTOR_PATH = /^\/panels\/(\d+)\/vectors\/(-|\d+)$/
/** コマそのもの、コマの配列、矩形に届くパス。critique で AI に触らせないもの */
const PANEL_RECT_PATH = /^\/panels(\/(-|\d+)(\/rect(\/.*)?)?)?$/

/**
 * 提案 Patch のパスをページを根にする。`/episodes/<n>/pages/<n>` で始まるパスはその接頭辞を外す。
 * 添字は見ないので、どのページに当てるかは呼び出し側が決める
 */
export function pageRootedPatch(patch: Patch): Patch {
  return patch.map((op) => ({ ...op, path: op.path.replace(PAGE_PREFIX, '') }))
}

/**
 * critique の提案 Patch を、位置をロックしていない焦点とフキダシの `pos` の replace、ベクトルの add だけに限って検査する。
 * パスは pageRootedPatch でページを根にしてから `page` に照らす。
 * 添字が無い、値が型どおりでない、ベクトルの id が重なる、ベクトルの端が同じコマの焦点かフキダシでない操作は拒否する。
 * 空の Patch も適用するものが無いので拒否する
 */
export function checkCritiquePatch(page: Page, patch: Patch): CritiquePatchCheck {
  if (patch.length === 0) return { ok: false, rejection: { code: 'empty' } }
  const vectorIds = new Set(page.panels.flatMap((p) => p.vectors.map((v) => v.id)))
  const rooted = pageRootedPatch(patch)
  for (const op of rooted) {
    const rejection = checkOperation(page, op, vectorIds)
    if (rejection !== undefined) return { ok: false, rejection }
  }
  return { ok: true, patch: rooted }
}

function checkOperation(
  page: Page,
  op: Patch[number],
  vectorIds: Set<string>,
): CritiquePatchRejection | undefined {
  const { path } = op
  if (PANEL_RECT_PATH.test(path)) return { code: 'rect' }

  const pos = POS_PATH.exec(path)
  if (pos) {
    if (op.op !== 'replace') return { code: 'replace_only', path }
    const panel = page.panels[Number(pos[1])]
    const items = pos[2] === 'focusPoints' ? panel?.focusPoints : panel?.bubbles
    const item = items?.[Number(pos[3])]
    if (!item) return { code: 'missing_item', path }
    if (item.locked) return { code: 'locked', path }
    if (!PointSchema.safeParse(op.value).success) return { code: 'not_point', path }
    return undefined
  }

  const vector = VECTOR_PATH.exec(path)
  if (vector) {
    if (op.op !== 'add') return { code: 'vector_add_only' }
    const panel = page.panels[Number(vector[1])]
    if (!panel) return { code: 'missing_panel', path }
    if (vector[2] !== '-' && Number(vector[2]) > panel.vectors.length) {
      return { code: 'index_out_of_range', path }
    }
    const parsed = VectorSchema.safeParse(op.value)
    if (!parsed.success) return { code: 'not_vector', path }
    const value = parsed.data
    if (vectorIds.has(value.id)) return { code: 'vector_id_taken', id: value.id }
    vectorIds.add(value.id)
    const anchors = new Set([
      ...panel.focusPoints.map((f) => f.id),
      ...panel.bubbles.map((b) => b.id),
    ])
    for (const id of [value.sourceFocusId, value.targetFocusId]) {
      if (id !== undefined && !anchors.has(id)) {
        return { code: 'vector_endpoint', id }
      }
    }
    return undefined
  }

  return { code: 'not_allowed', op: op.op, path }
}

if (import.meta.vitest) {
  const { describe, expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')
  const { aiFixtures } = await import('./fake-llm-provider')

  const page = fixtures.samplePage01.episodes[0]?.pages[0] as Page
  const vector = {
    id: 'vc_new',
    kind: 'gaze',
    from: { x: 0.1, y: 0.1 },
    to: { x: 0.5, y: 0.5 },
    strength: 'weak',
    targetFocusId: 'fp_5_e',
  }

  test('accepts every fake suggestion and strips the project prefix', () => {
    for (const { patch } of aiFixtures.critique.suggestions) {
      const checked = checkCritiquePatch(page, patch)
      expect(checked.ok).toBe(true)
      if (!checked.ok) continue
      for (const op of checked.patch) expect(op.path).toMatch(/^\/panels\//)
    }
  })

  test('accepts page-rooted focus, bubble and vector operations', () => {
    const patch: Patch = [
      { op: 'replace', path: '/panels/0/focusPoints/1/pos', value: { x: 0.3, y: 0.7 } },
      { op: 'replace', path: '/panels/0/bubbles/0/pos', value: { x: 0.9, y: 0.2 } },
      { op: 'add', path: '/panels/4/vectors/0', value: vector },
    ]
    expect(checkCritiquePatch(page, patch)).toEqual({ ok: true, patch })
  })

  test('rejects moving a locked bubble', () => {
    const locked = {
      ...page,
      panels: page.panels.map((p, i) =>
        i === 0 ? { ...p, bubbles: p.bubbles.map((b) => ({ ...b, locked: true })) } : p,
      ),
    }
    const checked = checkCritiquePatch(locked, [
      { op: 'replace', path: '/panels/0/bubbles/0/pos', value: { x: 0.9, y: 0.2 } },
    ])
    expect(checked.ok).toBe(false)
    if (!checked.ok)
      expect(checked.rejection).toEqual({ code: 'locked', path: '/panels/0/bubbles/0/pos' })
  })

  describe('rejects patches that touch the panel rect', () => {
    test.each([
      { op: 'replace', path: '/panels/0/rect', value: { x: 0, y: 0, w: 1, h: 1 } },
      { op: 'replace', path: '/episodes/0/pages/0/panels/2/rect/w', value: 0.5 },
      { op: 'replace', path: '/panels/1', value: {} },
      { op: 'remove', path: '/panels/1' },
      { op: 'add', path: '/panels/-', value: {} },
      { op: 'replace', path: '/panels', value: [] },
    ] as const)('%j', (op) => {
      expect(checkCritiquePatch(page, [op])).toEqual({ ok: false, rejection: { code: 'rect' } })
    })

    test('even when the other operations are allowed', () => {
      const checked = checkCritiquePatch(page, [
        { op: 'replace', path: '/panels/0/focusPoints/0/pos', value: { x: 0.5, y: 0.5 } },
        { op: 'replace', path: '/panels/0/rect/x', value: 0.1 },
      ])
      expect(checked).toEqual({ ok: false, rejection: { code: 'rect' } })
    })
  })

  test.each([
    [[], 'empty'],
    [[{ op: 'remove', path: '/panels/0/focusPoints/0/pos' }], 'replace_only'],
    [
      [{ op: 'replace', path: '/panels/0/focusPoints/9/pos', value: { x: 0, y: 0 } }],
      'missing_item',
    ],
    [[{ op: 'replace', path: '/panels/0/bubbles/0/pos', value: { x: 2, y: 0 } }], 'not_point'],
    [[{ op: 'replace', path: '/panels/0/bubbles/0/text', value: 'x' }], 'not_allowed'],
    [[{ op: 'replace', path: '/panels/0/focusPoints/0/weight', value: 1 }], 'not_allowed'],
    [[{ op: 'remove', path: '/panels/0/vectors/0' }], 'vector_add_only'],
    [[{ op: 'add', path: '/panels/9/vectors/-', value: vector }], 'missing_panel'],
    [[{ op: 'add', path: '/panels/4/vectors/5', value: vector }], 'index_out_of_range'],
    [[{ op: 'add', path: '/panels/4/vectors/-', value: { id: 'v' } }], 'not_vector'],
    [
      [{ op: 'add', path: '/panels/4/vectors/-', value: { ...vector, id: 'vc_1_a' } }],
      'vector_id_taken',
    ],
    [
      [
        { op: 'add', path: '/panels/4/vectors/-', value: vector },
        { op: 'add', path: '/panels/4/vectors/-', value: vector },
      ],
      'vector_id_taken',
    ],
    [
      [{ op: 'add', path: '/panels/4/vectors/-', value: { ...vector, targetFocusId: 'fp_1_e' } }],
      'vector_endpoint',
    ],
    [[{ op: 'replace', path: '/title', value: 't' }], 'not_allowed'],
  ] as [Patch, CritiquePatchRejection['code']][])('rejects %j', (patch, code) => {
    const checked = checkCritiquePatch(page, patch)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.rejection.code).toBe(code)
  })
}
