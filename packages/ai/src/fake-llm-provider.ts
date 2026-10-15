import { CritiqueResponseSchema, LayoutProposalResponseSchema } from '@manga/schema'
import critique from '../../../docs/fixtures/ai/critique.json'
import layoutProposal from '../../../docs/fixtures/ai/layout-proposal.json'
import type { LlmProvider } from './provider'

/** `docs/fixtures/ai/` の固定応答。読み込み時に検証済み */
export const aiFixtures = {
  layoutProposal: LayoutProposalResponseSchema.parse(layoutProposal),
  critique: CritiqueResponseSchema.parse(critique),
}

/** 入力に関わらず docs/fixtures/ai/ の応答を返す LlmProvider */
export function createFakeLlmProvider(): LlmProvider {
  return {
    async proposeLayout() {
      return structuredClone(aiFixtures.layoutProposal)
    },
    async critique() {
      return structuredClone(aiFixtures.critique)
    },
  }
}
