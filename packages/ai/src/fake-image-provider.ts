import type { ID } from '@manga/schema'
import { placeholderPng, placeholderSize } from './placeholder'
import { prompts } from './prompts'
import {
  findPanel,
  type ImageProvider,
  type PanelArtRequest,
  type PanelArtResponse,
} from './provider'

/**
 * 画像を生成せず、コマ番号を描いた灰色の矩形を返す ImageProvider。
 * フィクスチャの 6 コマに対する出力は docs/fixtures/art/<panelId>.png と同じバイト列になる。
 * `art` に panelId -> PNG を渡すと、そのコマではそれをそのまま返す。
 */
export class FakeImageProvider implements ImageProvider {
  constructor(private readonly art: Record<ID, Blob> = {}) {}

  async generatePanelArt(req: PanelArtRequest): Promise<PanelArtResponse> {
    const { prompt } = prompts.panelArt({ ...req, instruction: req.previous?.instruction })
    const panel = findPanel(req.page, req.panelId)
    const image =
      this.art[req.panelId] ??
      new Blob([placeholderPng(panel.order, placeholderSize(panel, req.project.settings))], {
        type: 'image/png',
      })
    return { image, provider: 'fake', prompt }
  }
}
