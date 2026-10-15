# WS-20 scribble

Phase 4 / 開発中の依存: DOC のみ / 統合時: WS-04

## 目的
手描きメモの線を引く。漫画家と編集者の赤入れ用。筆圧、傾き、スムージングは持たない。出力画像には出ない。

## スコープ
- `tool === 'scribble'` のとき、Pointer Events で点列を取り `Page.scribbles` に `Stroke` を追加する Patch を発行。
- 描画中は SVG `<polyline>` を直接更新し、pointerup で Patch を 1 回だけ出す。
- 点の間引き: 距離 0.002（ページ幅比）未満の点は捨てる。
- 消しゴム: ストローク単位。クリックしたストロークを削除。
- 色: `ink`, `red`, `blue` の 3 色。太さは 1 種類（`width: 0.002`）。
- レイヤー表示切替は `layers.scribble`。
- マウス、タッチ、ペン（Apple Pencil 含む）で同じ挙動。タッチ時は 1 本指で描画、2 本指でパン。

## 受け入れ条件
- [ ] 1 ストローク 1 Patch
- [ ] iPad Safari で 1 本指描画と 2 本指パンが共存する
- [ ] 1 ページ 500 ストロークでも 60fps
- [ ] Undo で直前のストロークが消える（store 側の履歴に乗る）
