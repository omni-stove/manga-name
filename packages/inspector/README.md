# @manga/inspector

選択中の要素を編集する右ペインのフォーム群。仕様は `docs/workstreams/WS-05-inspector.md`。
ランタイム依存は `@manga/schema` と peer の `react` のみ。

```sh
pnpm --filter @manga/inspector dev        # フィクスチャの各要素を順に出すプレイグラウンド（src/dev）
pnpm --filter @manga/inspector test
pnpm --filter @manga/inspector typecheck
```

## 公開 API

| export | 内容 |
|---|---|
| `PanelInspector` | order、camera、note、フキダシ一覧の順序入替、生成セクション（生成、修正して再生成、`arts` の履歴と切替、送ったプロンプト） |
| `BubbleInspector` | speakerId、text、shape、order |
| `CharacterInspector` | name、shortName、appearance、参照画像のサムネイルと差し替え、note |
| `PageInspector` | side、note、「このページを全部生成」、診断の集計 |
| `ProjectSettingsInspector` | direction、pageSize、dpi、style.prompt、style.negative |
| `*InspectorProps` | 各 props の型 |

## Patch

`onChange(patch)` の path は渡したオブジェクト（Panel、Bubble、Character、Page、ProjectSettings）を root とする。
親（Project）への付け替えは `apps/web` が行う。

- text / note / appearance の複数行欄は 300ms debounce。blur と unmount で即座に流す。それ以外の欄は入力のたびに出す
- スキーマを通らない値（dpi が正の整数でない、order が 1 未満など）は Patch を出さず `aria-invalid` を付ける
- 任意項目を空にすると `remove`、入れると `add`
