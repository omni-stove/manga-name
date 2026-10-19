import type {
  CharacterArtRequest,
  CritiqueResponse,
  ID,
  LayoutSuggestionResponse,
  Page,
  PageArtRequest,
  PageDiagnosis,
  PagePlanResponse,
  PanelArtRequest,
  Project,
} from '@manga/schema'

export type {
  CharacterArtRequest,
  CritiqueResponse,
  LayoutSuggestionResponse,
  PageArtRequest,
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

/** ページ割りの要求 */
export interface PagePlanRequest {
  project: Pick<Project, 'settings' | 'characters'>
  /** 脚本テキスト */
  script: string
  /** 脚本を割り振るページ数。省くと LLM に任せる */
  pageCount?: number
}

/** 1 ページのコマ割りの提案の要求 */
export interface LayoutSuggestionRequest {
  project: Pick<Project, 'settings' | 'characters'>
  /** ページの脚本（Page.script） */
  script: string
}

export interface CritiqueRequest {
  page: Page
  diagnosis: PageDiagnosis
}

export interface ImageProvider {
  generatePanelArt(req: PanelArtRequest): Promise<PanelArtResponse>
  /** ページ 1 枚分の絵を 1 回で作る。image はページ全体で、コマへの切り抜きは呼び出し側がする */
  generatePageArt(req: PageArtRequest): Promise<PanelArtResponse>
  /** キャラの参照画像を名前と外見から 1 枚作る。縦長の全身 */
  generateCharacterArt(req: CharacterArtRequest): Promise<PanelArtResponse>
}

/** 各メソッドは応答のスキーマを通った値を返し、通らない応答は throw する */
export interface LlmProvider {
  /** 脚本をページに割り振り、ページごとの流れ、登場キャラ、セリフを返す。コマ割りはしない */
  planPages(req: PagePlanRequest): Promise<PagePlanResponse>
  /** 1 ページの脚本を段とコマに割った案を返す。コマごとに描くもの、カメラ、セリフを持つ */
  suggestLayout(req: LayoutSuggestionRequest): Promise<LayoutSuggestionResponse>
  critique(req: CritiqueRequest): Promise<CritiqueResponse>
}

/** page から panelId の Panel を返す。無ければ throw */
export function findPanel(page: Page, panelId: ID) {
  const panel = page.panels.find((p) => p.id === panelId)
  if (!panel) throw new Error(`panel ${panelId} is not in page ${page.id}`)
  return panel
}
