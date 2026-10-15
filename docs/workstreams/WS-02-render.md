# WS-02 render

Phase 1 / 開発中の依存: DOC のみ / パッケージ: `packages/render`

## 目的
出力画像を作る決定論的レンダラ。同じ `Page` と同じアセットからは同じ PNG が出る。キャンバス（WS-04）とは別実装で、出力の正はこちら。

## 公開 API
`03-data-model.md` の「レンダラ」の通り。

```ts
export function renderPage(page: Page, ctx: RenderContext, opts: RenderOptions): Promise<Blob>;
export function renderLayoutPng(page: Page, panelId: ID, opts: { width: number }): Promise<Blob>;
export function exportPdf(project: Project, episodeId: ID, opts: RenderOptions & { pages: 'all' | ID[]; spread: boolean }): Promise<Blob>;   // Phase 2（WS-08）
export function layoutBubbleText(text: string, size: Size, fontPx: number): { lines: string[][]; fontPx: number };   // 縦書きの行割り。テストしやすいよう公開
```

## 描画仕様（renderPage）
- キャンバスサイズ: `pageSize` と `dpi` から px を計算。`width` 指定時はそれに合わせて縮尺。
- 背景白。
- コマごとに:
  - `currentArt` があれば `loadAsset` で読み、`rect` に cover で配置して枠でクリップ。
  - なければ白地。コマ番号を左上に、`note` と `camera` を枠内に小さく印字する（生成前のネーム）。
  - 枠線: 黒、太さはページ幅の 0.003。
  - `panelNumbers` なら右上に番号。
- フキダシ: `shape` ごとの輪郭。`normal` は楕円、`shout` はギザギザ、`thought` は雲形、`narration` は角丸矩形。白塗り黒線。`tail` があればしっぽを描く。
- セリフ: 縦書き。右の行から左へ。フォントは Noto Sans JP（`.ttf` を同梱して `FontFace` で登録）。`size` に収まる最大の文字サイズを `layoutBubbleText` が決める。下限はページ幅の 0.012。長音「ー」と括弧は 90 度回転。句読点はそのまま置く。
- `notes: 'margin'` ならページ右端（ltr なら左端）に幅 15% の余白を足し、コマ番号と `camera` と `note` を横書きで列挙する。`'sheet'` は `exportPdf` が別ページを作る。`renderPage` は `'none'` と同じ。
- 焦点、ベクトル、診断、参考画像、手描きは描かない。

## 描画仕様（renderLayoutPng）
- 対象コマの `rect` を切り出した PNG。アスペクト比はコマのまま。
- 薄灰（#e0e0e0）で塗り、フキダシ領域を白で塗る。枠線は黒。
- 文字は描かない。生成プロバイダが「白い領域は空けておく」と解釈できればよい。

## 実装
- `OffscreenCanvas` を使い、Web Worker で動くように DOM に依存しない。Node のテストでは `@napi-rs/canvas` を使う（devDependency）。
- フォント読み込みは 1 回だけ。`loadFonts()` を内部で memo。

## モック
- 生成画像は `docs/fixtures/art/pn_*.png`（WS-03 が供給。それまでは自前で灰色矩形を作る）。

## 受け入れ条件
- [ ] フィクスチャ（arts 空）を `renderPage` すると 6 コマの枠とフキダシ 3 つとセリフが描かれる。スナップショット PNG をテストに残す
- [ ] `arts` にフィクスチャ画像を入れた場合も同様にスナップショット
- [ ] 同じ入力で 2 回描いてバイト一致する
- [ ] 縦書きで「……芽が」が 1 行、20 文字のセリフが 2 行以上に割れる。「ー」が回転する（スナップショット）
- [ ] `renderLayoutPng` で Panel 6 を描くとフキダシ領域が白、それ以外が薄灰になる（画素をサンプリングして検証）
- [ ] 300dpi の 1 ページを 500ms 以内（Node ベンチ）
