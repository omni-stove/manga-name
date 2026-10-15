# WS-19 collaboration

Phase 4 / 開発中の依存: DOC のみ / 統合時: WS-06, WS-13 / パッケージ: `workers/api`, `packages/storage`, `apps/web`

## 目的
漫画家や編集者が同じプロジェクトを開いて赤を入れる。範囲は `06-open-questions.md` #11 の決定に従う。

## 方針
- Yjs。`Project` を `Y.Map` / `Y.Array` にマッピングする。`ProjectStore.applyPatch` の実装を Yjs トランザクションに差し替える。呼び出し側は変わらない。
- Durable Object を 1 プロジェクト 1 インスタンスとして `y-websocket` 相当のプロトコルで同期。永続化は DO storage、スナップショットを定期的に D1 の `doc` に書く。
- Presence: 誰がどのページのどの要素を選択しているかをカーソル色で表示。
- 権限: owner / editor / viewer / commenter。招待はメール。commenter は手描きメモ（WS-20）とコメントだけ書ける。
- オフライン編集は Yjs の性質で自然にマージされる。WS-15 の 409 分岐は不要になる。

## 受け入れ条件
- [ ] 2 クライアントで同時にフキダシをドラッグしても両方の変更が残る
- [ ] 片方がオフラインで編集し復帰後にマージされる
- [ ] Undo が自分の変更だけを戻す（Yjs UndoManager）
- [ ] 生成した画像が他クライアントにも表示される
- [ ] Phase 1 の全操作が共同編集モードでも動く（WS-21 の E2E で確認）
