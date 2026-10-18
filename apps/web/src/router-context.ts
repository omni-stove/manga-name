import type { AuthClient } from './auth'
import type { PanelGeneration } from './generate-panel'
import type { ImageProvider } from './image-provider'
import type { LlmProvider } from './llm-provider'
import type { ProjectLibrary } from './project-library'
import type { SharingClient } from './sharing'

/** 各ルートの loader と画面が `context` から使う依存 */
export interface RouterContext {
  library: ProjectLibrary
  /** 生成に使う ImageProvider。`createImageProvider()` で API の URL とログインから作る */
  imageProvider: ImageProvider
  /** 「脚本から下書き」と「AI に相談」に使う LlmProvider。`createLlmProvider()` で API の URL とログインから作る */
  llmProvider: LlmProvider
  /** コマの生成と進行状況。画面を離れても生成が続くよう、ルーターより長く生きる */
  generation: PanelGeneration
  /** プロジェクトの参加者と招待 */
  sharing: SharingClient
  /** ログイン状態。ログインが要る読み込みを loader で分けるのに使う */
  auth: Pick<AuthClient, 'getUser'>
}
