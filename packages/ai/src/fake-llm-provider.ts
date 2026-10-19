import {
  CritiqueResponseSchema,
  LayoutSuggestionResponseSchema,
  NameDraftResponseSchema,
  PagePlanResponseSchema,
} from '@manga/schema'
import critique from '../../../fixtures/ai/critique.json'
import layoutSuggestion from '../../../fixtures/ai/layout-suggestion.json'
import nameDraft from '../../../fixtures/ai/name-draft.json'
import pagePlan from '../../../fixtures/ai/page-plan.json'
import type { LlmProvider } from './provider'

/** `fixtures/ai/` の固定応答。読み込み時に検証済み */
export const aiFixtures = {
  pagePlan: PagePlanResponseSchema.parse(pagePlan),
  nameDraft: NameDraftResponseSchema.parse(nameDraft),
  layoutSuggestion: LayoutSuggestionResponseSchema.parse(layoutSuggestion),
  critique: CritiqueResponseSchema.parse(critique),
}

/**
 * 入力に関わらず fixtures/ai/ の応答を返す LlmProvider。planPages は `pageCount` があれば、
 * フィクスチャの 2 ページを繰り返してその枚数にする。suggestLayout は案を要求のコマの数に合わせ、
 * 数の合う案はそのまま、合わない案は 1 段に 1 コマずつ並べ直して返す
 */
export function createFakeLlmProvider(): LlmProvider {
  return {
    async planPages(req) {
      const pages = structuredClone(aiFixtures.pagePlan)
      if (req.pageCount === undefined) return pages
      // Workers が枚数の不一致を弾くので、指定の枚数にそろえる
      return Array.from({ length: req.pageCount }, (_, i) =>
        structuredClone(pages[i % pages.length] as (typeof pages)[number]),
      )
    },
    async transcribeName() {
      return structuredClone(aiFixtures.nameDraft)
    },
    async suggestLayout(req) {
      // Workers がネームとコマの数の合わない案を弾くので、利用者が足し引きしたコマの数にそろえる
      const options = structuredClone(aiFixtures.layoutSuggestion).options.map((option) =>
        option.rows.reduce((n, row) => n + row.panels.length, 0) === req.panels.length
          ? option
          : { ...option, rows: req.panels.map(() => ({ height: 1, panels: [{ width: 1 }] })) },
      )
      return { options }
    },
    async critique() {
      return structuredClone(aiFixtures.critique)
    },
  }
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')

  test('planPages repeats the fixture pages up to pageCount', async () => {
    const { settings, characters } = fixtures.samplePage01
    const req = { project: { settings, characters }, script: 's' }
    const provider = createFakeLlmProvider()
    expect(await provider.planPages(req)).toEqual(aiFixtures.pagePlan)
    const res = await provider.planPages({ ...req, pageCount: 3 })
    expect(res).toHaveLength(3)
    expect(res[2]).toEqual(aiFixtures.pagePlan[0])
  })

  test('suggestLayout keeps the options that fit the name and restacks the others', async () => {
    const provider = createFakeLlmProvider()
    const { panels } = aiFixtures.nameDraft
    expect(await provider.suggestLayout({ panels })).toEqual(aiFixtures.layoutSuggestion)
    const res = await provider.suggestLayout({ panels: [...panels, ...panels] })
    for (const option of res.options) {
      expect(option.rows.flatMap((row) => row.panels)).toHaveLength(panels.length * 2)
    }
  })
}
