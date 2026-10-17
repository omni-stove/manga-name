import type {
  CharacterArtRequest,
  CritiqueResponse,
  ID,
  LayoutProposalResponse,
  Page,
  PageDiagnosis,
  PagePlanResponse,
  PanelArtRequest,
  Project,
} from '@manga/schema'

export type {
  CharacterArtRequest,
  CritiqueResponse,
  LayoutProposalResponse,
  PagePlanResponse,
  PanelArtRequest,
}

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
  /** 脚本を割り振るページ数。省くと LLM に任せる */
  pageCount?: number
}

/** ページ割りの要求。項目は LayoutProposalRequest と同じ */
export type PagePlanRequest = LayoutProposalRequest

export interface CritiqueRequest {
  page: Page
  diagnosis: PageDiagnosis
}

export interface ImageProvider {
  generatePanelArt(req: PanelArtRequest): Promise<PanelArtResponse>
  /** キャラの参照画像を名前と外見から 1 枚作る。縦長の全身 */
  generateCharacterArt(req: CharacterArtRequest): Promise<PanelArtResponse>
}

export interface LlmProvider {
  /** 脚本をページに割り振り、ページごとの流れと登場キャラを返す。コマ割りはしない */
  planPages(req: PagePlanRequest): Promise<PagePlanResponse>
  proposeLayout(req: LayoutProposalRequest): Promise<LayoutProposalResponse>
  critique(req: CritiqueRequest): Promise<CritiqueResponse>
}

/** page から panelId の Panel を返す。無ければ throw */
export function findPanel(page: Page, panelId: ID) {
  const panel = page.panels.find((p) => p.id === panelId)
  if (!panel) throw new Error(`panel ${panelId} is not in page ${page.id}`)
  return panel
}
