import {
  CritiqueResponseSchema,
  LayoutProposalResponseSchema,
  PagePlanResponseSchema,
} from '@manga/schema'
import critique from '../../../docs/fixtures/ai/critique.json'
import layoutProposal from '../../../docs/fixtures/ai/layout-proposal.json'
import pagePlan from '../../../docs/fixtures/ai/page-plan.json'
import type { LlmProvider } from './provider'

/** `docs/fixtures/ai/` の固定応答。読み込み時に検証済み */
export const aiFixtures = {
  pagePlan: PagePlanResponseSchema.parse(pagePlan),
  layoutProposal: LayoutProposalResponseSchema.parse(layoutProposal),
  critique: CritiqueResponseSchema.parse(critique),
}

/**
 * 入力に関わらず docs/fixtures/ai/ の応答を返す LlmProvider。proposeLayout だけは `pageCount` があれば、
 * フィクスチャのページを繰り返してその枚数にする
 */
export function createFakeLlmProvider(): LlmProvider {
  return {
    async planPages() {
      return structuredClone(aiFixtures.pagePlan)
    },
    async proposeLayout(req) {
      const { pages, rationale } = structuredClone(aiFixtures.layoutProposal)
      if (req.pageCount === undefined) return { pages, rationale }
      // ページ割りのまとまりごとの要求でも、どのページにもコマ割りが返る形にする
      return {
        pages: Array.from({ length: req.pageCount }, (_, i) =>
          structuredClone(pages[i % pages.length] as (typeof pages)[number]),
        ),
        rationale,
      }
    },
    async critique() {
      return structuredClone(aiFixtures.critique)
    },
  }
}

if (import.meta.vitest) {
  const { expect, test } = import.meta.vitest
  const { fixtures } = await import('@manga/schema')

  test('proposeLayout repeats the fixture page up to pageCount', async () => {
    const { settings, characters } = fixtures.samplePage01
    const req = { project: { settings, characters }, script: 's' }
    const provider = createFakeLlmProvider()
    expect(await provider.proposeLayout(req)).toEqual(aiFixtures.layoutProposal)
    const res = await provider.proposeLayout({ ...req, pageCount: 3 })
    expect(res.pages).toHaveLength(3)
    expect(res.pages[2]).toEqual(aiFixtures.layoutProposal.pages[0])
  })
}
