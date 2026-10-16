# @manga/ai

画像生成と LLM のプロバイダ抽象、プロンプト構築、Fake 実装。UI は持たない。
仕様は `docs/03-data-model.md` の「AI プロバイダ」と `docs/workstreams/WS-03-ai-core.md`。
ランタイム依存は `@manga/schema` のみ。

```sh
pnpm --filter @manga/ai test
pnpm --filter @manga/ai typecheck
```

## 公開 API

| export | 内容 |
|---|---|
| `ImageProvider`, `LlmProvider` | プロバイダの interface |
| `PanelArtRequest`, `PanelArtResponse`, `LayoutProposalRequest`, `LayoutProposalResponse`, `CritiqueRequest`, `CritiqueResponse` | 入出力の型。応答の型は `@manga/schema` の再 export |
| `prompts.panelArt(req)` | 画像生成プロンプト `{ prompt, negative }` |
| `prompts.proposeLayout(req)`, `LlmPrompt`, `JsonSchema` | レイアウト提案のプロンプト `{ system, user, schema }` |
| `createFakeImageProvider` | コマ番号を描いた灰色の矩形 PNG を返す |
| `createFakeLlmProvider`, `aiFixtures` | `docs/fixtures/ai/` の固定応答を返す |
| `createHttpImageProvider`, `createHttpLlmProvider`, `HttpProviderOptions` | Workers のプロキシを叩くプロバイダ |
| `placeholderPng(order, size)`, `placeholderSize(panel, settings)` | 灰色の矩形 PNG の生成。他パッケージが未生成コマの代替に使える |
| `findPanel(page, panelId)` | Panel の検索。無ければ throw |

`prompts.critique` と Workers の `/v1/ai/critique` ルートは critique のタスクで足す。それまで `createHttpLlmProvider().critique` は 404 で throw する。

## prompts.panelArt

WS-03 の順に要素を改行で連結し、空の要素は飛ばす。

1. `settings.style.prompt`
2. `camera: <camera>`
3. `note`
4. 登場キャラ。`bubbles[].speakerId` と `focusPoints[].characterId` を登場順に集め、`<name>: <appearance>` を `; ` で並べる
5. `focusPoints[].label` を `weight` 降順に `; ` で並べる
6. `vectors` を `<kind> from <始点> to <終点>` で並べる。端点は焦点なら `"<label>"`、フキダシなら `speech bubble <order>`、どちらも無ければ `(x, y)`
7. `hint`
8. `revise the previous image: <instruction>`
9. 固定の末尾

`negative` は `settings.style.negative`。無ければ空文字。

## prompts.proposeLayout

- `system` は出力規則（ID の `tmp_` 接頭辞、0..1 座標、`settings.direction` に沿った読み順、セリフの抜き出しと `speakerId`、
  `note` へのト書き、`camera` の推定、空の `arts`）と、`@manga/schema` の `layoutProposalJsonSchema()` を JSON にしたもの。
- `user` はキャラの `id` / `name` / `shortName`、ページ数の目安（`pageCount`。無ければ脚本次第）、1 ページ 3〜6 コマの目安、脚本。
- `schema` は `layoutProposalJsonSchema()`。構造化出力に対応したプロバイダにはこれを渡す。
  JSON Schema は参照整合を表さないので、応答は必ず `LayoutProposalResponseSchema` で検証する。

## HTTP プロバイダ

`createHttpLlmProvider({ baseUrl, getToken })` は `POST /v1/ai/propose-layout` に `LayoutProposalRequest` を JSON で送り、
応答を `LayoutProposalResponseSchema` で検証して返す。トークン無し、HTTP エラー（502 を含む）、検証に通らない応答は throw する。

## モック

### createFakeImageProvider

```ts
const provider = createFakeImageProvider()
const { image, prompt } = await provider.generatePanelArt(req)   // image は PNG の Blob、provider は 'fake'
```

画像はコマの縦横比で長辺 512px の灰色の矩形。`placeholderPng` は同じ引数から常に同じバイト列を作るので、
フィクスチャの 6 コマに対する出力は `docs/fixtures/art/pn_1.png` 〜 `pn_6.png` と一致する。
別の画像を返したいときは `createFakeImageProvider({ pn_4: blob })` のように panelId ごとに渡す。

`docs/fixtures/art/*.png` は生成物。`placeholderPng` を変えたら次で作り直す。

```sh
pnpm exec vitest run packages/ai/scripts/emit-art.test.ts
```

### createFakeLlmProvider

`proposeLayout` は `docs/fixtures/ai/layout-proposal.json`、`critique` は `docs/fixtures/ai/critique.json` を入力に関わらず返す。
どちらも読み込み時に `@manga/schema` で検証する。critique の Patch の path は Project を根にしたもので、
フィクスチャの `pg_1`（`/episodes/0/pages/0`）に対する提案になっている。
