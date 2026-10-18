import { CritiqueResponseSchema, PagePlanResponseSchema } from '@manga/schema'
import critique from '../../../fixtures/ai/critique.json'
import pagePlan from '../../../fixtures/ai/page-plan.json'
import type { LlmProvider } from './provider'

/** `fixtures/ai/` の固定応答。読み込み時に検証済み */
export const aiFixtures = {
  pagePlan: PagePlanResponseSchema.parse(pagePlan),
  critique: CritiqueResponseSchema.parse(critique),
}

/**
 * 入力に関わらず fixtures/ai/ の応答を返す LlmProvider。planPages は `pageCount` があれば、
 * フィクスチャの 2 ページを繰り返してその枚数にする
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
}
