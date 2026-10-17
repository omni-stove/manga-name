# WS-03 ai-core

Phase 1 / 開発中の依存: DOC のみ / パッケージ: `packages/ai`, `workers/api`

## 目的
画像生成と LLM のプロバイダ抽象、プロンプト構築、応答の検証、Workers のプロキシルート。UI は持たない。Phase 1 で必要なのは画像生成だけで、LLM は Phase 2 以降の WS が使う。

## 公開 API（`packages/ai`）
```ts
export interface ImageProvider { generatePanelArt }           // 03-data-model.md の通り
export interface LlmProvider { proposeLayout, critique }
export function createFakeImageProvider(art?: Record<ID, Blob>): ImageProvider;   // docs/fixtures/art/<panelId>.png を返す。無ければ灰色矩形
export function createFakeLlmProvider(): LlmProvider;                             // docs/fixtures/ai/ の固定応答
export function createHttpImageProvider(opts: HttpProviderOptions): ImageProvider; // Workers のプロキシを叩く
export function createHttpLlmProvider(opts: HttpProviderOptions): LlmProvider;
export interface HttpProviderOptions { baseUrl: string; getToken(): Promise<string | null> }
export const prompts: {
  panelArt(req: Omit<PanelArtRequest, 'layoutPng' | 'referencePng' | 'characterRefs' | 'previous'> & { instruction?: string }): { prompt: string; negative: string };
  proposeLayout(req: LayoutProposalRequest): { system: string; user: string; schema: JsonSchema };
  critique(req: CritiqueRequest): { system: string; user: string; schema: JsonSchema };
};
```

## panelArt のプロンプト構成
順に連結する。空の要素は飛ばす。
1. `settings.style.prompt`
2. `camera`（あれば「camera: <camera>」）
3. `note`
4. コマに登場するキャラ。`cast`、`bubbles[].speakerId`、`focusPoints[].characterId` の順に集め（`panelCharacterIds`）、`name` と `appearance` を「<name>: <appearance>」で列挙
5. `focusPoints` の `label` を `weight` 降順に列挙
6. `vectors` を「<kind> from <source label or 位置> to <target label or 位置>」で列挙
7. `hint`
8. 再生成なら「revise the previous image: <instruction>」
9. 固定の末尾: 「no text, no letters, no speech bubbles, leave the white areas of the layout image empty」

negative は `settings.style.negative`。

## Phase 1 の実プロバイダ（06-open-questions.md #1 #2 の決定）
- Google Gemini `gemini-nano-banana-2.1`（generateContent、`responseModalities: ['IMAGE']`、1K）。API キーは Workers の secret `GEMINI_API_KEY`。
- 画像は parts に inlineData で、配置図、参照画像、キャラ参照（`<name>` を直前のテキスト part で示す）、前回の絵の順に並べ、最後にプロンプトを置く。
- 配置図は参照画像として渡すだけで、マスクは使わない。白抜きが守られなくてもフキダシはレンダラが上に重ねる。
- 目視でモノクロ線画が出なければ OpenAI gpt-image-2.5 に替える。プロバイダは Workers の中だけで差し替え、アプリの契約は変えない。

## Workers ルート（Phase 1）
```
POST /v1/ai/panel-art    multipart (json: PanelArtRequest の Blob 以外 / layout: png / reference?: png / character_<id>?: png / previous?: png) -> image/png
GET  /v1/health
```
- `Authorization: Bearer <APP_ACCESS_TOKEN>` を要求する。トークンは Workers の secret。アプリは設定画面で入力してローカルに保存する。Phase 3 で WS-14 の認証に置き換える。
- プロバイダの実装は Workers 側にだけ置く。API キーは Workers の secret。
- 応答画像が空または decode できなければ 1 回だけ再試行、だめなら 502。
- 利用量を D1 に記録（`ai_usage(token_hash, kind, cost_units, created_at)`）。Phase 3 で user_id に替える。
- 1 トークンあたり 10 req/min のレート制限。

## モック
- `createFakeImageProvider` の画像は `docs/fixtures/art/pn_1.png` 〜 `pn_6.png`。灰色の矩形にコマ番号と簡単な線を描いた 512px 程度の PNG。このブリーフの担当が最初に commit する。
- `createFakeLlmProvider` の応答は `docs/fixtures/ai/`。

## 受け入れ条件
- [ ] `prompts.panelArt` のスナップショットテスト。フィクスチャ Panel 4 で note、camera、E の appearance、2 焦点、3 ベクトルが順に含まれる
- [ ] `createFakeImageProvider` がフィクスチャ 6 コマの PNG を返し、decode できる
- [ ] Workers ルートが Fake で end-to-end で動く（`@cloudflare/vitest-plugin`）
- [ ] トークン無しは 401、不正応答は再試行後 502、11 回目は 429
- [ ] 実プロバイダ 1 社でフィクスチャ Panel 4 からモノクロ線画が返る（目視。`docs/fixtures/art/real/` に残す）
