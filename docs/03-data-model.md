# 03. データモデル（共有契約）

このファイルは全パッケージが依存する契約。`packages/schema` はこの定義を Zod に写したものであり、このファイルが正。
変更は PR で提案し、`schemaVersion` を上げ、マイグレーションを同梱する。

## 設計原則

- 座標はすべて正規化する。ページ座標は `0..1`（左上原点）。コマ内座標はそのコマの矩形に対する `0..1`。ページサイズや DPI に依存しない。
- 読み順は Panel の `order` に明示的に持つ。配置からの自動推定は診断側が行い、`order` と食い違えば警告する。
- 生成画像はアセットとして保存し、Panel はその参照と履歴を持つ。画像の本体はドキュメント JSON に入れない。
- 診断結果は保存しない。常に `Page` から再計算する。
- ID は `nanoid` 相当の文字列。参照はすべて ID で行う。
- 自由記述は `note` に入れる。構造化されていない情報を無理に型にしない。

## 型定義

```ts
type ID = string;
type ISODate = string;           // "2026-10-15T10:00:00.000Z"

/** 0..1 正規化座標 */
interface Point { x: number; y: number }
interface Size  { w: number; h: number }
interface Rect  { x: number; y: number; w: number; h: number }

type ReadingDirection = 'rtl' | 'ltr';   // rtl = 右綴じ縦書き（既定）

interface Project {
  schemaVersion: 4;
  id: ID;
  title: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  settings: ProjectSettings;
  characters: Character[];
  episodes: Episode[];
}

interface ProjectSettings {
  direction: ReadingDirection;
  /** 仕上がりサイズ。出力画像のアスペクト比と解像度に使う */
  pageSize: { w: number; h: number; unit: 'mm' };   // 既定 182x257
  /** 出力解像度。既定 300 */
  dpi: number;
  /** 生成の共通スタイル。全コマのプロンプトに前置する */
  style: {
    prompt: string;          // 既定 "manga name rough, monochrome line art, loose sketch"
    negative?: string;       // 既定 "text, letters, speech bubbles, color"
  };
  /** 診断の閾値。省略時は 04-diagnosis-spec.md の既定値 */
  diagnosis?: Partial<DiagnosisConfig>;
}

interface Character {
  id: ID;
  name: string;
  shortName: string;     // 図中ラベル用。例 "E"
  /** 外見の記述。生成プロンプトに入る。例 "少女、ショートカット、丸眼鏡、白衣" */
  appearance?: string;
  /** 参照画像。生成時に添付する */
  referenceRef?: string;
  note?: string;
}

interface Episode {
  id: ID;
  title: string;
  pages: Page[];         // 配列順がページ順
}

interface Page {
  id: ID;
  /** 見開きのどちら側か。rtl なら奇数ページが左 */
  side: 'left' | 'right' | 'single';
  panels: Panel[];
  /** 参考画像。生成の参照にだけ使い、出力には出ない */
  reference?: ReferenceImage;
  scribbles: Stroke[];
  /** このページで起きること。「脚本から下書き」はページごとの話の流れをここに入れる */
  note?: string;
  /** 登場キャラ（Character.id）。コマの登場キャラは書かなくてもページの登場キャラに数える */
  cast?: ID[];
}

interface Panel {
  id: ID;
  /** 読み順。1 始まり。ページ内で一意 */
  order: number;
  /** ページ座標。shape があればその輪郭を囲む矩形 */
  rect: Rect;
  /**
   * コマの輪郭。rect に対するコマ内座標の頂点列（3 点以上）。斜めに割ったコマや台形、三角形を表す。
   * 省略時は rect そのもの。絵は rect に cover で置き、輪郭の外を切る
   */
  shape?: Point[];
  bubbles: Bubble[];
  /** 演出指示。芝居、時間、感情など自由記述。生成プロンプトの主成分 */
  note?: string;
  camera?: string;       // 例 "ロング", "アオリ", "俯瞰"
  /** 生成画像の履歴。新しいものを末尾に追加 */
  arts: PanelArt[];
  /** 採用中の生成画像。省略時は未生成として扱う */
  artId?: ID;
  /** 構図のヒント。生成プロンプトと診断に使う。省略可 */
  focusPoints: FocusPoint[];
  vectors: Vector[];
  /** 視線経路の上書き。省略時は centre sweep（y = 0.5） */
  sweep?: Sweep;
  /** 登場キャラ（Character.id）。台詞も焦点も無いキャラを生成に渡すために持つ。話者と焦点のキャラは書かなくても登場キャラに数える */
  cast?: ID[];
}

interface Bubble {
  id: ID;
  /** コマ内の読み順。1 始まり */
  order: number;
  speakerId?: ID;        // 省略時はナレーションまたは不明
  text: string;
  shape: 'normal' | 'shout' | 'thought' | 'narration';
  /** コマ内座標。フキダシの中心 */
  pos: Point;
  /** コマ内座標。フキダシの大きさ */
  size: Size;
  /** しっぽの先端。コマ内座標。省略時はしっぽなし */
  tail?: Point;
  /**
   * true なら本体をコマの枠からはみ出させてよい。省略時は、フキダシの作成・移動・リサイズ、
   * コマのリサイズ・分割・結合・頂点の移動、AI の下書きと提案のたびに本体を枠の内側に収める
   * （輪郭から 2mm 空け、収まらなければ縮める）。しっぽは枠の外へ出てよい
   */
  overflow?: boolean;
}

interface PanelArt {
  id: ID;
  /** ストレージアダプタが解決する参照。"blob:<id>" | "file:<relative path>" | "r2:<key>" */
  ref: string;
  provider: string;
  /** 実際に送ったプロンプト */
  prompt: string;
  /** 再生成時の修正指示 */
  instruction?: string;
  /** 再生成の元になった PanelArt */
  parentId?: ID;
  createdAt: ISODate;
}

type Sweep =
  | { kind: 'centre'; y: number }                 // コマを横断する水平線。y はコマ内 0..1
  | { kind: 'polyline'; points: Point[] };        // 手動指定。入口から出口へ

type FocusKind = 'face' | 'keyObject' | 'sfx';

interface FocusPoint {
  id: ID;
  kind: FocusKind;
  label: string;         // 例 "E masked, intent"。生成プロンプトに入る
  /** コマ内座標 */
  pos: Point;
  /** 注目の重み 0..1。描画半径と診断の優先度に使う */
  weight: number;
  characterId?: ID;      // kind === 'face' のとき
}

type VectorKind = 'gaze' | 'motion' | 'speed';
type Strength = 'strong' | 'weak';

interface Vector {
  id: ID;
  kind: VectorKind;
  /** コマ内座標 */
  from: Point;
  to: Point;
  strength: Strength;
  /** 始点が乗っている焦点。省略可 */
  sourceFocusId?: ID;
  /** 終点が向いている焦点。省略可 */
  targetFocusId?: ID;
}

interface ReferenceImage {
  ref: string;
  opacity: number;       // 0..1。キャンバス表示用
  visible: boolean;
}

interface Stroke {
  id: ID;
  /** ページ座標の点列。筆圧なし */
  points: Point[];
  width: number;         // ページ幅に対する比率。既定 0.002
  color: 'ink' | 'red' | 'blue';
}
```

## 診断結果の型（計算結果。保存しない）

診断では Bubble も焦点として扱う。`FocusDiagnosis.kind === 'bubble'` のとき `focusPointId` は Bubble の ID。

```ts
interface DiagnosisConfig {
  /** 焦点が経路から外れていないと見なす距離。コマ高さに対する比率 */
  pathBand: number;              // 既定 0.40
  /** ok と判定するために必要な条件。04-diagnosis-spec.md 参照 */
  requireStrongForOk: boolean;   // 既定 false
}

type FocusStatus = 'ok' | 'weak' | 'miss';

interface FocusDiagnosis {
  focusPointId: ID;              // FocusPoint の ID、または kind === 'bubble' なら Bubble の ID
  kind: FocusKind | 'bubble';
  panelId: ID;
  /** 経路上の位置。0 入口、1 出口 */
  t: number;
  /** 経路からの距離。コマ高さに対する比率 */
  distance: number;
  strong: number;                // 強い誘導線の本数
  weak: number;                  // 弱い誘導線の本数
  status: FocusStatus;
  reason?: string;               // miss / weak の理由。UI 表示用
}

interface PanelDiagnosis {
  panelId: ID;
  /** 実際に描画する経路。ページ座標の点列 */
  sweepPath: Point[];
  focus: FocusDiagnosis[];
  /** フキダシ順と t の整合 */
  bubbleOrderOk: boolean;
  /** 生成プロンプトに渡す一文。例 "視線は右上のフキダシから中央の顔、左下の手元へ流れる" */
  hint: string;
}

interface PageDiagnosis {
  pageId: ID;
  /** Panel.order が配置から推定した順と一致するか */
  readingOrderOk: boolean;
  /** 推定した順。readingOrderOk が false のとき UI が提案に使う */
  inferredOrder: ID[];
  panels: PanelDiagnosis[];
  /** ページ横断のフキダシ経路。ページ座標 */
  bubbleChain: Point[];
  summary: { total: number; ok: number; weak: number; miss: number };
  issues: Issue[];
}

interface Issue {
  severity: 'error' | 'warning' | 'info';
  code: 'READING_ORDER' | 'BUBBLE_ORDER' | 'FOCUS_MISS' | 'FOCUS_WEAK' | 'EMPTY_PANEL' | 'OVERLAP';
  panelId?: ID;
  focusPointId?: ID;
  message: string;
}
```

## パッチ形式（store と AI 提案の共通インターフェース）

store への変更はすべて JSON Patch（RFC 6902）で表現する。AI の提案も JSON Patch で返す。
これにより store が Zustand でも Yjs（共同編集）でも、呼び出し側のコードは変わらない。

```ts
type Patch = { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }[];

interface ProjectStore {
  get(): Project;
  applyPatch(patch: Patch, meta?: { source: 'user' | 'ai' | 'remote'; label?: string }): void;
  subscribe(listener: (p: Project) => void): () => void;
  undo(): void;
  redo(): void;
}
```

## ストレージアダプタ

```ts
interface StorageAdapter {
  listProjects(): Promise<{ id: ID; title: string; updatedAt: ISODate }[]>;
  loadProject(id: ID): Promise<Project>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: ID): Promise<void>;
  /** ref を解決して表示用 URL を返す */
  resolveAsset(ref: string): Promise<string>;
  /** ref を解決して Blob を返す。レンダラと生成の添付用 */
  loadAsset(ref: string): Promise<Blob>;
  /** 画像を保存し ref を返す */
  putAsset(projectId: ID, blob: Blob, hint?: string): Promise<string>;
}
```

## レンダラ

```ts
interface RenderContext {
  settings: ProjectSettings;
  characters: Character[];
  loadAsset(ref: string): Promise<Blob>;
}
interface RenderOptions {
  /** 出力幅 px。省略時は pageSize と dpi から計算 */
  width?: number;
  /** 指示メモの印字。'none' | 'margin'（コマ横の余白）| 'sheet'（別ページ） */
  notes: 'none' | 'margin' | 'sheet';
  panelNumbers: boolean;
}

/** ページ 1 枚を合成した PNG */
function renderPage(page: Page, ctx: RenderContext, opts: RenderOptions): Promise<Blob>;
/** 生成に渡す配置図。コマ枠内を対象にし、フキダシ領域を白、それ以外を薄灰で塗った PNG */
function renderLayoutPng(page: Page, panelId: ID, opts: { width: number }): Promise<Blob>;
/** ページ全体の生成に渡す配置図。白地にコマの内側を薄灰、フキダシ領域を白、コマ枠を黒で描いた PNG */
function renderPageLayoutPng(page: Page, opts: { width: number }): Promise<Blob>;
/** ページ全体の絵を各コマを囲む rect で切り抜く。切り抜きがそのコマの PanelArt になる */
function cropPanelArts(page: Page, image: Blob): Promise<{ panelId: ID; image: Blob }[]>;
/** エピソードの全ページを PDF に束ねる */
function exportPdf(
  project: Project,
  episodeId: ID,
  opts: RenderOptions & {
    pages: 'all' | ID[];
    spread: boolean;
    /** StorageAdapter.loadAsset を渡す。採用中の PanelArt を読むのに使う */
    loadAsset(ref: string): Promise<Blob>;
    /** 1 ページ描き終えるごとに呼ぶ。done は描き終えたページ数、total は対象のページ数 */
    onProgress?(done: number, total: number): void;
  },
): Promise<Blob>;
```

## AI プロバイダ

```ts
interface PanelArtRequest {
  project: Pick<Project, 'settings' | 'characters'>;
  page: Page;
  panelId: ID;
  /** render.renderLayoutPng の出力 */
  layoutPng: Blob;
  /** 診断から得たヒント。省略可 */
  hint?: string;
  /** Page.reference のコマ領域切り抜き。省略可 */
  referencePng?: Blob;
  /** コマに登場するキャラの参照画像。省略可 */
  characterRefs?: { characterId: ID; image: Blob }[];
  /** 再生成時。前回の絵と修正指示 */
  previous?: { art: Blob; instruction: string };
}
/** ページ 1 枚分の絵を 1 回で作る。修正指示つきの再生成はコマ単位だけ */
interface PageArtRequest {
  project: Pick<Project, 'settings' | 'characters'>;
  page: Page;
  /** render.renderPageLayoutPng の出力 */
  layoutPng: Blob;
  /** コマごとの診断のヒント。キーは Panel.id。省略可 */
  hints?: Record<ID, string>;
  /** Page.reference をページ丸ごと。省略可 */
  referencePng?: Blob;
  /** ページに登場するキャラの参照画像。出るコマの多い順。省略可 */
  characterRefs?: { characterId: ID; image: Blob }[];
}
interface PanelArtResponse {
  image: Blob;                          // PNG。generatePageArt ではページ全体
  provider: string;
  prompt: string;
}

interface LayoutProposalRequest {
  project: Pick<Project, 'settings' | 'characters'>;
  script: string;                       // 脚本テキスト
  pageCount?: number;
}
interface LayoutProposalResponse {
  pages: Page[];                        // 新規ページ案。ID は仮。arts は空
  rationale: string;
}

type PagePlanRequest = LayoutProposalRequest;
interface PagePlan {
  note: string;                         // このページで起きること。Page.note になる
  cast: ID[];                           // このページに出るキャラ。Page.cast になる
  script: string;                       // このページに割り振った脚本の抜き書き
}
interface PagePlanResponse {
  pages: PagePlan[];                    // 1 ページ以上
  rationale: string;
}

interface CritiqueRequest {
  page: Page;
  diagnosis: PageDiagnosis;
}
interface CritiqueResponse {
  summary: string;
  suggestions: { message: string; patch: Patch }[];
}

interface ImageProvider {
  generatePanelArt(req: PanelArtRequest): Promise<PanelArtResponse>;
  generatePageArt(req: PageArtRequest): Promise<PanelArtResponse>;
  generateCharacterArt(req: CharacterArtRequest): Promise<PanelArtResponse>;
}
interface LlmProvider {
  planPages(req: PagePlanRequest): Promise<PagePlanResponse>;
  proposeLayout(req: LayoutProposalRequest): Promise<LayoutProposalResponse>;
  critique(req: CritiqueRequest): Promise<CritiqueResponse>;
}
```

## フィクスチャ

`docs/fixtures/sample-page-01.json` は 6 コマ 1 ページを本契約で表現したもの。`arts` は空で、生成前のネームを表す。
レンダラは絵のない状態でこのページを合成できること、診断エンジンは `04-diagnosis-spec.md` の期待値を再現することを受け入れ条件とする。
