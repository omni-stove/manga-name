import type { Character, ProjectSettings } from '@manga/schema'

export interface RenderContext {
  settings: ProjectSettings
  characters: Character[]
  loadAsset(ref: string): Promise<Blob>
}

export interface RenderOptions {
  /** 1 ページ分の出力幅 px。見開きはこの 2 倍の幅になる。省略時は pageSize と dpi から計算 */
  width?: number
  /** 指示メモの印字。'margin' はコマ横の余白、'sheet' は exportPdf が別ページを作るので renderPage では 'none' と同じ */
  notes: 'none' | 'margin' | 'sheet'
  panelNumbers: boolean
}

/** 1 枚のキャンバス。描き終えたら toPng で PNG にする */
export interface Surface {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  toPng(): Promise<Blob>
}

/** 描画先の環境差を閉じ込める。ブラウザは OffscreenCanvas、Node は @napi-rs/canvas */
export interface Backend {
  createSurface(width: number, height: number): Surface
  decodeImage(blob: Blob): Promise<CanvasImageSource>
  /** `weight` は可変フォントの太さの範囲（CSS の font-weight の記法） */
  registerFont(family: string, url: URL, weight?: string): Promise<void>
}
