# WS-11 hints-overlay

Phase 2 / 開発中の依存: DOC のみ / 統合時: WS-04, WS-05, WS-07, WS-10 / パッケージ: `packages/editor-canvas`, `packages/inspector`, `apps/web`

## 目的
構図のヒント（焦点と誘導線）を置く操作と、視線誘導診断のオーバーレイ表示、ヒントの生成プロンプトへの受け渡し。

## editor-canvas への追加
- `focus` ツール: クリックで配置。種別はツールバーで選ぶ。ドラッグで移動。
- `vector` ツール: ドラッグで始点から終点。終点が焦点かフキダシ上なら `targetFocusId` を自動設定。
- `layers.hints` で焦点とベクトルの表示切替。`layers.diagnosis` でオーバーレイ。
- 描画:
  - 焦点: 種別で色分け。face 青、keyObject 橙、sfx 紫。半径は `weight` に比例。中心に点。ラベルを点の右下に小さく表示。
  - ベクトル: 緑の矢印。strong は実線、weak は細線。
  - centre sweep: 灰色破線。コマ内は水平線、コマ間は斜線。
  - bubble chain: マゼンタ太線。各フキダシに縦横の薄いピンク破線。
  - 焦点ラベルに診断を付ける: `<label> <S>S/<W>W t<t> <status>`。
  - 凡例と集計行をキャンバス下部に描く。例: `reading order OK | focus points: 12 ok 12 miss 0`。

## inspector への追加
- FocusInspector: kind、label、weight（スライダー）、characterId。診断の t / S / W / status / reason を表示。
- VectorInspector: kind、strength、targetFocusId（セレクト。焦点とフキダシ）。
- IssueList: severity 順。クリックで `onFocus`。エディタ右ペインの下に置く。
- PanelInspector の生成セクションに `hint` を読み取り専用で表示し、「ヒントを使う」のチェック（既定オン）。

## apps/web への追加
- `diagnosePage` を `useMemo` で呼び、キャンバスとインスペクタに渡す。
- WS-07 の `generatePanel` が `panelHint` の結果を `PanelArtRequest.hint` に入れる。

## モック
- 診断結果は `docs/fixtures/sample-page-01.diagnosis.json` を読む。

## 受け入れ条件
- [ ] フィクスチャ + diagnosis を描画すると集計行 `reading order OK | focus points: 12 ok 12 miss 0` が出る
- [ ] focus / vector の各操作が 1 Patch で出る。`targetFocusId` 自動設定のテスト
- [ ] 各フォームの全フィールドが Patch を発火する。IssueList クリックで選択が移る
- [ ] 生成リクエストに `hint` が入る（Fake プロバイダで受け取った文字列を検証）
- [ ] `layers.hints` と `layers.diagnosis` を切ると描画されない
