# WS-07 panel-art

Phase 1 / 開発中の依存: DOC のみ / 統合時: WS-02, WS-03, WS-04, WS-06 / パッケージ: `apps/web`

## 目的
コマの絵を生成し、履歴に積み、採用し、ページ PNG を書き出すまでの配線。アプリの中心機能。

## スコープ
- 生成 1 回の流れ（`02-architecture.md` のデータフロー「生成」）を `generatePanel(projectId, pageId, panelId, instruction?)` にまとめる。
  1. `renderLayoutPng`
  2. 診断ヒント（Phase 2。無ければ省略）
  3. 参考画像の切り抜き（Phase 2。無ければ省略）
  4. 登場キャラの `referenceRef` を `loadAsset`
  5. 再生成なら `currentArt` を `loadAsset` して `previous` に
  6. `ImageProvider.generatePanelArt`
  7. `putAsset` → `applyPatch([{ add /panels/i/arts/- }, { replace /panels/i/artId }], { source: 'ai', label })`
- 失敗時はトースト。Patch は出さない。
- 進行管理: `generating: Set<panelId>` を store の外（Zustand の別 store）に持ち、キャンバスとインスペクタに渡す。同じコマの二重起動は拒否。
- 一括生成: ページ単位（`PageInspector`）とエピソード単位（ページ一覧の「全部生成」）。コマ単位に分解し、同時 3 並列で実行。未生成コマだけを対象にし、「生成済みも含める」のチェックで全部。
- キャンセル: `AbortController` を各呼び出しに渡す。キャンセル後に届いた応答は捨てる。
- 履歴: `arts` の切替、削除（採用中は削除不可）。削除はアセットも消す。
- 書き出し（Phase 1 の範囲）: 「このページを PNG で保存」。`renderPage` を Web Worker で実行し、ダウンロード。`notes: 'none'`、`panelNumbers: false` を既定にし、ダイアログで変えられる。

## モック
- `FakeImageProvider`。応答に 500ms の遅延を入れて進行表示を確認する。

## 受け入れ条件
- [ ] Fake でコマ 1 つを生成し、キャンバスに出て、`arts` が 1 件増え、`artId` が指す
- [ ] 修正指示つき再生成で `arts` が 2 件になり、`parentId` と `instruction` が入る
- [ ] Undo で `artId` が前の版に戻り、Redo で進む
- [ ] ページ一括で 6 コマが並列 3 で生成され、途中キャンセルで残りが止まる
- [ ] 生成中にページを離れて戻っても状態が壊れない
- [ ] PNG 書き出しが `renderPage` のスナップショットと一致する
- [ ] 実プロバイダで 1 コマ生成し、合成ページを目視確認
