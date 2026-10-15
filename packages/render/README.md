# @manga/render

決定論的レンダラ。同じ `Page` と同じアセットからは同じ PNG が出る。
仕様は `docs/03-data-model.md` の「レンダラ」と `docs/workstreams/WS-02-render.md`。
ランタイム依存は `@manga/schema` のみ。ブラウザでは `OffscreenCanvas`、Node では `@napi-rs/canvas`（devDependency）で描く。

```sh
pnpm --filter @manga/render test
pnpm --filter @manga/render typecheck
```

## 公開 API

| export | 内容 |
|---|---|
| `renderPage(page, ctx, opts)` | ページ 1 枚を PNG の Blob に合成する |
| `renderLayoutPng(page, panelId, { width, pageSize? })` | 生成に渡す配置図。コマ枠内を薄灰、フキダシ領域を白で塗った PNG |
| `layoutBubbleText(text, size, fontPx)` | 縦書きの行割り。`size` は px の箱、`fontPx` は文字サイズの下限 |
| `rotatesInVertical(glyph)` | 縦書きで 90 度回転する字か（長音、ダッシュ、三点リーダ、括弧） |
| `RenderContext`, `RenderOptions` | 入力の型 |

`exportPdf` は task 23 で足す。

## renderPage

- キャンバスは `pageSize` と `dpi` から px を計算する。`width` 指定時はアスペクト比を保ってその幅にする
- コマは `order` 順に描く。`artId` があれば `loadAsset` で読み、`rect` に cover で置いて枠で切る。無ければ白地にコマ番号、`[camera]`、`note` を横書きで小さく印字する
- 枠線は黒でページ幅の 0.003。`panelNumbers` なら右上に白丸の番号
- フキダシは `normal` 楕円、`shout` ギザギザ、`thought` 雲形、`narration` 角丸矩形。白塗り黒線。`tail` があれば三角（`thought` は小さい円 2 つ）で繋ぐ
- セリフは Noto Sans JP の縦書きで右の行から左へ。文字サイズは箱に収まる最大で、下限はページ幅の 0.012。長音と括弧は回転し、句読点はそのまま置く。行頭禁則の字は前の行の末尾ごと次の行へ送る
- `notes: 'margin'` はページ右端（`ltr` なら左端）にページ幅 15% の余白を足し、コマ番号と `camera` と `note` を横書きで列挙する。出力の幅は `width` より広くなる。`'sheet'` は `'none'` と同じ
- 焦点、ベクトル、診断、参考画像、手描きは描かない

## renderLayoutPng

対象コマの `rect` を切り出した PNG。アスペクト比はコマのままで、`pageSize`（mm。省略時は 182x257）から計算する。
薄灰 `#e0e0e0` で塗り、フキダシ本体としっぽを白で塗り、枠線を黒で引く。文字は描かない。

## フォント

`fonts/NotoSansJP.ttf` は Google Fonts の `NotoSansJP[wght].ttf`（SIL OFL 1.1、`fonts/OFL.txt`）。
ブラウザでは `FontFace` で、Node では `GlobalFonts.registerFromPath` で、初回の描画時に 1 回だけ登録する。

## テスト

in-source テストは `@napi-rs/canvas` で描く。スナップショット PNG は `src/__snapshots__/` に置き、
無ければ最初の `pnpm test` が書く（CI では失敗する）。PNG のバイト列は OS ごとに変わるので、
デコードした画素をチャンネル差 2 まで許して比べる。描画を変えたらファイルを消して再実行する。
