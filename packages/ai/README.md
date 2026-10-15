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
| `createFakeImageProvider` | コマ番号を描いた灰色の矩形 PNG を返す |
| `createFakeLlmProvider`, `aiFixtures` | `docs/fixtures/ai/` の固定応答を返す |
| `placeholderPng(order, size)`, `placeholderSize(panel, settings)` | 灰色の矩形 PNG の生成。他パッケージが未生成コマの代替に使える |
| `findPanel(page, panelId)` | Panel の検索。無ければ throw |

`createHttpImageProvider` / `createHttpLlmProvider` と `prompts.proposeLayout` / `prompts.critique` は Workers ルートのタスクで足す。

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
