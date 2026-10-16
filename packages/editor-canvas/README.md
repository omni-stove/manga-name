# @manga/editor-canvas

1 ページを SVG で描く React コンポーネント。仕様は `docs/workstreams/WS-04-editor-canvas.md`。
ランタイム依存は `@manga/schema` と peer の `react` のみ。

```sh
pnpm --filter @manga/editor-canvas dev        # フィクスチャを読むプレイグラウンド（src/dev）
pnpm --filter @manga/editor-canvas test
pnpm --filter @manga/editor-canvas typecheck
```

## 公開 API

| export | 内容 |
|---|---|
| `EditorCanvas(props)` | ページ、コマ、生成画像、フキダシ（縦書き）、生成中スピナーを描く。ホイールとピンチでズーム、Space ドラッグと 2 本指でパン |
| `EditorCanvasProps` / `Selection` / `Tool` / `Layers` | props の型 |

## 座標系

SVG のユーザー単位はページの mm（`settings.pageSize`）。正規化座標の `Rect` は `x * pageSize.w` などで置く。
ズームとパンは viewBox の差し替えで、ページを含む全体表示がズーム 1。線は `vector-effect: non-scaling-stroke` でズームに関わらず同じ太さ。
