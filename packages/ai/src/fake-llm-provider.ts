import { CritiqueResponseSchema, LayoutProposalResponseSchema } from '@manga/schema'
import critique from '../../../docs/fixtures/ai/critique.json'
import layoutProposal from '../../../docs/fixtures/ai/layout-proposal.json'
import type {
  CritiqueRequest,
  CritiqueResponse,
  LayoutProposalRequest,
  LayoutProposalResponse,
  LlmProvider,
} from './provider'

/** `docs/fixtures/ai/` の固定応答。読み込み時に検証済み */
export const aiFixtures = {
  layoutProposal: LayoutProposalResponseSchema.parse(layoutProposal),
  critique: CritiqueResponseSchema.parse(critique),
}

/** 入力に関わらず docs/fixtures/ai/ の応答を返す LlmProvider */
export class FakeLlmProvider implements LlmProvider {
  async proposeLayout(_req: LayoutProposalRequest): Promise<LayoutProposalResponse> {
    return structuredClone(aiFixtures.layoutProposal)
  }

  async critique(_req: CritiqueRequest): Promise<CritiqueResponse> {
    return structuredClone(aiFixtures.critique)
  }
}
