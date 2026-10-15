import type {
  CritiqueResponse,
  ID,
  LayoutProposalResponse,
  Page,
  PageDiagnosis,
  PanelArtRequest,
  Project,
} from '@manga/schema'

export type { CritiqueResponse, LayoutProposalResponse, PanelArtRequest }

/** 生成結果。image は PNG */
export interface PanelArtResponse {
  image: Blob
  provider: string
  /** 実際に送ったプロンプト。PanelArt.prompt に保存する */
  prompt: string
}

export interface LayoutProposalRequest {
  project: Pick<Project, 'settings' | 'characters'>
  /** 脚本テキスト */
  script: string
  pageCount?: number
}

export interface CritiqueRequest {
  page: Page
  diagnosis: PageDiagnosis
}

export interface ImageProvider {
  generatePanelArt(req: PanelArtRequest): Promise<PanelArtResponse>
}

export interface LlmProvider {
  proposeLayout(req: LayoutProposalRequest): Promise<LayoutProposalResponse>
  critique(req: CritiqueRequest): Promise<CritiqueResponse>
}

/** page から panelId の Panel を返す。無ければ throw */
export function findPanel(page: Page, panelId: ID) {
  const panel = page.panels.find((p) => p.id === panelId)
  if (!panel) throw new Error(`panel ${panelId} is not in page ${page.id}`)
  return panel
}
