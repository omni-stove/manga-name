import { type Page, type Patch, PointSchema, VectorSchema } from '@manga/schema'

/**
 * critique の提案 Patch の検査結果。`ok` なら `patch` はページを根にしたパスに直したもの。
 * `ok: false` の `reason` は利用者にそのまま見せる文言
 */
export type CritiquePatchCheck = { ok: true; patch: Patch } | { ok: false; reason: string }

/** Project を根にしたパスの、ページまでの接頭辞。LLM がプロジェクト根で返しても受け付ける */
const PAGE_PREFIX = /^\/episodes\/\d+\/pages\/\d+(?=\/)/
const POS_PATH = /^\/panels\/(\d+)\/(focusPoints|bubbles)\/(\d+)\/pos$/
const VECTOR_PATH = /^\/panels\/(\d+)\/vectors\/(-|\d+)$/
/** コマそのもの、コマの配列、矩形に届くパス。critique で AI に触らせないもの */
const PANEL_RECT_PATH = /^\/panels(\/(-|\d+)(\/rect(\/.*)?)?)?$/

const REJECT_RECT = 'コマの矩形（rect）を変える提案なので適用できません'

/**
 * 提案 Patch のパスをページを根にする。`/episodes/<n>/pages/<n>` で始まるパスはその接頭辞を外す。
 * 添字は見ないので、どのページに当てるかは呼び出し側が決める
 */
export function pageRootedPatch(patch: Patch): Patch {
  return patch.map((op) => ({ ...op, path: op.path.replace(PAGE_PREFIX, '') }))
}

/**
 * critique の提案 Patch を、焦点とフキダシの `pos` の replace、ベクトルの add だけに限って検査する。
 * パスは pageRootedPatch でページを根にしてから `page` に照らす。
 * 添字が無い、値が型どおりでない、ベクトルの id が重なる、ベクトルの端が同じコマの焦点かフキダシでない操作は拒否する。
 * 空の Patch も適用するものが無いので拒否する
 */
export function checkCritiquePatch(page: Page, patch: Patch): CritiquePatchCheck {
  if (patch.length === 0) return { ok: false, reason: '変更を含まない提案です' }
  const vectorIds = new Set(page.panels.flatMap((p) => p.vectors.map((v) => v.id)))
  const rooted = pageRootedPatch(patch)
  for (const op of rooted) {
    const reason = checkOperation(page, op, vectorIds)
    if (reason !== undefined) return { ok: false, reason }
  }
  return { ok: true, patch: rooted }
}

function checkOperation(page: Page, op: Patch[number], vectorIds: Set<string>): string | undefined {
  if (PANEL_RECT_PATH.test(op.path)) return REJECT_RECT

  const pos = POS_PATH.exec(op.path)
  if (pos) {
    if (op.op !== 'replace') return `${op.path} は replace でしか変えられません`
    const panel = page.panels[Number(pos[1])]
    const items = pos[2] === 'focusPoints' ? panel?.focusPoints : panel?.bubbles
    if (!items?.[Number(pos[3])]) return `${op.path} の要素がページにありません`
    if (!PointSchema.safeParse(op.value).success) {
      return `${op.path} の値が 0〜1 の座標ではありません`
    }
    return undefined
  }

  const vector = VECTOR_PATH.exec(op.path)
  if (vector) {
    if (op.op !== 'add') return 'ベクトルは追加しかできません'
    const panel = page.panels[Number(vector[1])]
    if (!panel) return `${op.path} のコマがページにありません`
    if (vector[2] !== '-' && Number(vector[2]) > panel.vectors.length) {
      return `${op.path} の添字が範囲外です`
    }
    const parsed = VectorSchema.safeParse(op.value)
    if (!parsed.success) return `${op.path} の値がベクトルの形をしていません`
    const value = parsed.data
    if (vectorIds.has(value.id)) return `ベクトルの id ${value.id} がもう使われています`
    vectorIds.add(value.id)
    const anchors = new Set([
      ...panel.focusPoints.map((f) => f.id),
      ...panel.bubbles.map((b) => b.id),
    ])
    for (const id of [value.sourceFocusId, value.targetFocusId]) {
      if (id !== undefined && !anchors.has(id)) {
        return `ベクトルの端 ${id} が同じコマの焦点かフキダシではありません`
      }
    }
    return undefined
  }

  return `${op.op} ${op.path} は AI の提案で変えられない箇所です`
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

  describe('rejects patches that touch the panel rect', () => {
    test.each([
      { op: 'replace', path: '/panels/0/rect', value: { x: 0, y: 0, w: 1, h: 1 } },
      { op: 'replace', path: '/episodes/0/pages/0/panels/2/rect/w', value: 0.5 },
      { op: 'replace', path: '/panels/1', value: {} },
      { op: 'remove', path: '/panels/1' },
      { op: 'add', path: '/panels/-', value: {} },
      { op: 'replace', path: '/panels', value: [] },
    ] as const)('%j', (op) => {
      expect(checkCritiquePatch(page, [op])).toEqual({ ok: false, reason: REJECT_RECT })
    })

    test('even when the other operations are allowed', () => {
      const checked = checkCritiquePatch(page, [
        { op: 'replace', path: '/panels/0/focusPoints/0/pos', value: { x: 0.5, y: 0.5 } },
        { op: 'replace', path: '/panels/0/rect/x', value: 0.1 },
      ])
      expect(checked).toEqual({ ok: false, reason: REJECT_RECT })
    })
  })

  test.each([
    [[], '変更を含まない'],
    [[{ op: 'remove', path: '/panels/0/focusPoints/0/pos' }], 'replace でしか'],
    [[{ op: 'replace', path: '/panels/0/focusPoints/9/pos', value: { x: 0, y: 0 } }], '要素'],
    [[{ op: 'replace', path: '/panels/0/bubbles/0/pos', value: { x: 2, y: 0 } }], '0〜1'],
    [[{ op: 'replace', path: '/panels/0/bubbles/0/text', value: 'x' }], '変えられない'],
    [[{ op: 'replace', path: '/panels/0/focusPoints/0/weight', value: 1 }], '変えられない'],
    [[{ op: 'remove', path: '/panels/0/vectors/0' }], '追加しか'],
    [[{ op: 'add', path: '/panels/9/vectors/-', value: vector }], 'コマがページにありません'],
    [[{ op: 'add', path: '/panels/4/vectors/5', value: vector }], '範囲外'],
    [[{ op: 'add', path: '/panels/4/vectors/-', value: { id: 'v' } }], 'ベクトルの形'],
    [[{ op: 'add', path: '/panels/4/vectors/-', value: { ...vector, id: 'vc_1_a' } }], '使われて'],
    [
      [
        { op: 'add', path: '/panels/4/vectors/-', value: vector },
        { op: 'add', path: '/panels/4/vectors/-', value: vector },
      ],
      '使われて',
    ],
    [
      [{ op: 'add', path: '/panels/4/vectors/-', value: { ...vector, targetFocusId: 'fp_1_e' } }],
      '同じコマ',
    ],
    [[{ op: 'replace', path: '/title', value: 't' }], '変えられない'],
  ] as [Patch, string][])('rejects %j', (patch, reason) => {
    const checked = checkCritiquePatch(page, patch)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.reason).toContain(reason)
  })
}
