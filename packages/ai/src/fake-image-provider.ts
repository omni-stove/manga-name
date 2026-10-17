import type { ID } from '@manga/schema'
import { placeholderPng, placeholderSize } from './placeholder'
import { prompts } from './prompts'
import { findPanel, type ImageProvider } from './provider'

/** キャラの参照画像の代わりに返す矩形の寸法。縦長の全身に合わせる */
const CHARACTER_SIZE = { w: 384, h: 512 }

/**
 * 画像を生成せず、コマ番号を描いた灰色の矩形を返す ImageProvider。キャラの参照画像は番号 0 の縦長の矩形。
 * フィクスチャの 6 コマに対する出力は docs/fixtures/art/<panelId>.png と同じバイト列になる。
 * `art` に panelId -> PNG を渡すと、そのコマではそれをそのまま返す。
 */
export function createFakeImageProvider(art: Record<ID, Blob> = {}): ImageProvider {
  return {
    async generatePanelArt(req) {
      const { prompt } = prompts.panelArt({ ...req, instruction: req.previous?.instruction })
      const panel = findPanel(req.page, req.panelId)
      const image =
        art[req.panelId] ??
        new Blob([placeholderPng(panel.order, placeholderSize(panel, req.project.settings))], {
          type: 'image/png',
        })
      return { image, provider: 'fake', prompt }
    },
    async generateCharacterArt(req) {
      const { prompt } = prompts.characterArt(req)
      const image = new Blob([placeholderPng(0, CHARACTER_SIZE)], { type: 'image/png' })
      return { image, provider: 'fake', prompt }
    },
  }
}
