import type {
  Character,
  FocusKind,
  ID,
  Page,
  PageDiagnosis,
  PageTurn,
  Patch,
  ProjectSettings,
} from '@manga/schema'

export type Selection = { kind: 'panel' | 'bubble' | 'focus' | 'vector'; id: ID } | null

export type Tool = 'select' | 'panel' | 'bubble' | 'focus' | 'vector' | 'scribble' | 'sketch'

/** `scribble` ツールで使うペンの色か消しゴム */
export type ScribbleTool = 'ink' | 'red' | 'blue' | 'eraser'

/** `sketch` ツールで使うペンか消しゴム */
export type SketchTool = 'pen' | 'eraser'

export interface Layers {
  reference: boolean
  art: boolean
  scribble: boolean
  /** 下描き（Page.sketch） */
  sketch: boolean
  hints: boolean
  diagnosis: boolean
  /** タチキリ枠、外枠（仕上がり線）、内枠 */
  frames: boolean
}

/** キャンバスの右クリック */
export interface CanvasMenuRequest {
  /** 押した位置の画面座標 */
  x: number
  y: number
  /** 押した要素。ページの何も無いところかページの外側なら null */
  target: Selection
  /** ズームとパンを全体表示に戻す */
  fit(): void
}

export interface EditorCanvasProps {
  page: Page
  settings: ProjectSettings
  characters: Character[]
  /** 視線誘導診断。null なら診断のレイヤーを描かない */
  diagnosis: PageDiagnosis | null
  /**
   * 提案を仮適用したページ。`page` と比べて動いた焦点とフキダシ、増えたベクトルを、
   * 元の位置と提案の位置の両方で破線で重ねる。操作は受けない
   */
  ghostPage?: Page
  /** ページがめくりの直前・直後か（`pageTurns`）。渡すとめくりの印を重ねる */
  turn?: PageTurn
  selection: Selection
  tool: Tool
  /** `tool === 'scribble'` のときの色か消しゴム。既定は ink */
  scribbleTool?: ScribbleTool
  /** `tool === 'sketch'` のときのペンか消しゴム。既定は pen */
  sketchTool?: SketchTool
  /** `focus` ツールで置く焦点の種別。ツールバーで選ぶ。既定は face */
  focusKind?: FocusKind
  layers: Layers
  /** 生成中のコマ。スピナーを重ねる */
  generating: Set<ID>
  /** ページ全体を 1 回で生成中。コマごとのスピナーの代わりにページに 1 つ重ね、生成ボタンを隠す */
  generatingPage?: boolean
  /** page を root とした JSON Patch */
  onChange(patch: Patch): void
  onSelect(sel: Selection): void
  /** コマのホバーに出す「生成」ボタン */
  onGenerate?(panelId: ID): void
  /** PanelArt.ref と Page.reference.ref を表示用 URL にする */
  resolveAsset(ref: string): Promise<string>
  /**
   * 右クリックで呼ぶ。渡すとブラウザのメニューを出さない。
   * 要素の上なら、先にその要素を `onSelect` で選んでから呼ぶ
   */
  onContextMenu?(request: CanvasMenuRequest): void
}
