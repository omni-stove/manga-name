# WS-09 reference-image

Phase 2 / 開発中の依存: DOC のみ / 統合時: WS-04, WS-06, WS-07 / パッケージ: `packages/editor-canvas`, `packages/storage`, `apps/web`

## 目的
原作者が持っているラフや資料画像をページの参考画像として読み込み、キャンバスの最下層に表示し、生成時にコマ領域を切り抜いて参照画像として渡す。出力画像には出ない。

## スコープ
- 対応形式: PNG, JPEG, PDF（1 ページ目を `pdfjs-dist` でラスタライズ）。
- 読み込み経路: ファイルドロップ、ファイル選択、クリップボード貼り付け。
- `StorageAdapter.putAsset` で保存し、`Page.reference = { ref, opacity: 0.5, visible: true }` を Patch で発行。
- キャンバス側: `resolveAsset(ref)` で URL を得て `<image>` として最下層に描画。`opacity`、`visible` を反映。
- インスペクタ側（PageInspector）: 不透明度スライダー、表示切替、差し替え、削除。
- 位置合わせ: ページ全体にフィット（アスペクト比維持、中央配置）。手動の位置調整は持たない。
- 生成への受け渡し: WS-07 の `generatePanel` が `Page.reference` を `loadAsset` し、`rect` でクロップして `referencePng` に入れる。コマごとに「参考画像を使う」のオン / オフ（既定オン。UI は PanelInspector の生成セクション）。
- キャラクターの参照画像（`Character.referenceRef`）の読み込みも同じ経路で行う。`CharacterInspector.onPickReference` から呼ぶ。

## モック
- `MemoryStorageAdapter` を使う。`resolveAsset` は `URL.createObjectURL`。

## 受け入れ条件
- [ ] 3 形式が読み込めて表示される
- [ ] 10MB の画像でもキャンバス操作が重くならない（読み込み時に長辺 2048px に縮小）
- [ ] 不透明度変更が即時反映
- [ ] 保存して再読込後も参考画像が復元される
- [ ] 生成リクエストの `referencePng` がコマの `rect` でクロップされている（寸法のテスト）
- [ ] `renderPage` の出力に参考画像が出ない
