# WS-12 layout-proposal

Phase 2 / 開発中の依存: DOC のみ / 統合時: WS-03, WS-06 / パッケージ: `packages/ai`, `apps/web`

## 目的
脚本テキストを入力して LLM にページ分割、コマ割り、フキダシとセリフ、指示メモの初期配置を出させ、プレビューして承認するとページとして追加される UI。

## Workers ルート
```
POST /v1/ai/propose-layout    LayoutProposalRequest -> LayoutProposalResponse
```
- 応答は `@manga/schema` の `LayoutProposalResponseSchema` で検証し、不正なら 1 回だけ再試行、だめなら 502。

## プロンプト方針
- 脚本を受け取り、ページ数とコマ数の目安を与え、`Page[]` を JSON Schema 準拠で返させる。ID は `tmp_` 接頭辞で仮発行。座標は 0..1。`arts` は空配列。
- セリフは脚本から抜き出し、フキダシの `pos` と `size` は読み順（rtl なら右上から）に沿って置かせる。
- `note` には脚本のト書きを、`camera` は推定を入れさせる。
- キャラは `characters` の `name` と `shortName` を渡し、`speakerId` を引かせる。

## フロー
1. エピソード画面の「脚本から下書き」ボタン。
2. モーダルで脚本（複数行）、ページ数の目安、トーンのヒントを入力。
3. `LlmProvider.proposeLayout` を呼び、進行表示。
4. 結果の `Page[]` を読み取り専用の `EditorCanvas` でサムネイル表示。`rationale` を横に表示。
5. ページ単位でチェックして「追加」。追加時に ID を `newId()` で振り直し、`applyPatch(..., { source: 'ai' })`。
6. 却下時は何も残らない。

## モック
- `FakeLlmProvider`。

## 受け入れ条件
- [ ] Fake で end-to-end が動く
- [ ] 追加後に Undo で丸ごと戻る
- [ ] 提案ページが `parseProject` を通らない場合はエラー表示して追加させない
- [ ] 進行中にモーダルを閉じても結果が後から壊れない（AbortController）
- [ ] 実プロバイダ 1 社で応答が Page スキーマを通る（10 回中 9 回以上）
