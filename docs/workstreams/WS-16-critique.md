# WS-16 critique

Phase 3 / 開発中の依存: DOC のみ / 統合時: WS-03, WS-10, WS-11 / パッケージ: `packages/ai`, `apps/web`

## 目的
診断結果を LLM に言語化させ、修正提案を 1 件ずつプレビューして適用できる UI。

## Workers ルート
```
POST /v1/ai/critique          CritiqueRequest -> CritiqueResponse
```

## プロンプト方針
- `PageDiagnosis` の Issue を箇条書きで渡し、修正は必ず JSON Patch で返させる。Patch は焦点の `pos` 変更、Vector 追加、Bubble の `pos` 変更に限定し、Panel の矩形は触らせない。

## フロー
1. エディタの Issue 一覧に「AI に相談」ボタン。
2. `CritiqueRequest { page, diagnosis }` を送る。
3. `summary` を表示し、`suggestions` をカードで並べる。
4. カードにホバーすると、Patch を仮適用した結果をキャンバスにゴースト表示（元の位置と提案位置を両方描く）。`EditorCanvas` に `ghostPage?: Page` prop を追加する。
5. 「適用」で `applyPatch(patch, { source: 'ai', label: message })`。適用後に診断が再計算され、Issue が減ることを見せる。
6. 適用したコマには「再生成」を促す表示を出す。

## モック
- `FakeLlmProvider`。

## 受け入れ条件
- [ ] Fake で end-to-end が動く
- [ ] 適用した提案は Undo で戻る
- [ ] Patch が Panel の rect を触る場合は拒否して警告する
- [ ] 実プロバイダで critique の Patch を適用して `diagnosePage` の miss が減るケースを 1 つテストで示す
