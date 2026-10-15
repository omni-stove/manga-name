# WS-10 diagnosis

Phase 2 / 開発中の依存: DOC のみ / パッケージ: `packages/diagnosis`

## 目的
`04-diagnosis-spec.md` を純粋関数として実装する。UI も I/O も持たない。補助機能だが、`hint` は生成プロンプトに入るので Phase 2 の最初に作る。

## 公開 API
```ts
export function diagnosePage(page: Page, settings: ProjectSettings): PageDiagnosis;
export function sweepPath(panel: Panel, direction: ReadingDirection): Point[];     // ページ座標
export function projectOntoSweep(panel: Panel, pos: Point, direction: ReadingDirection): { t: number; distance: number };
export function inferReadingOrder(panels: Panel[], direction: ReadingDirection): ID[];
export function bubbleChain(page: Page): Point[];
export function panelHint(panel: Panel, diagnosis: PanelDiagnosis): string;        // 04 の 10 節
export const defaultDiagnosisConfig: DiagnosisConfig;
```

## 制約
- 型は開発中 `src/contract.ts` に `03-data-model.md` から写す。統合時に `@manga/schema` に置換。
- Bubble は `04-diagnosis-spec.md` の 0 節の通り合成焦点にする。
- 1 ページ 30 コマ、1 コマ 20 焦点で 5ms 以内（毎操作で再計算するため）。
- `centre` と `polyline` の両方の sweep に対応する。`polyline` は折れ線上への射影で t を求める。

## 成果物
- パッケージ本体。
- `docs/fixtures/sample-page-01.diagnosis.json`: フィクスチャに対する出力。他 WS のモックに使われるので最初に commit する。

## 受け入れ条件
- [ ] `04-diagnosis-spec.md` の期待値表を ±0.02 で再現する
- [ ] 仕様末尾の 2 つの変形テスト（E crouched を下げると miss、Panel 2/3 の order 入替で READING_ORDER）が通る
- [ ] Panel 4 の `hint` が label の順と「大きく」を含む
- [ ] `ltr` でも t が反転して計算される
- [ ] `polyline` sweep のテストが 1 つある
- [ ] 入力を変更しない（`Object.freeze` した入力で動く）
- [ ] 上記の性能条件をベンチで確認
