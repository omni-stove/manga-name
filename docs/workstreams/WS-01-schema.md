# WS-01 schema

Phase 1 / 開発中の依存: DOC のみ / パッケージ: `packages/schema`

## 目的
`03-data-model.md` を Zod に写し、型、バリデーション、フィクスチャ、マイグレーションの置き場にする。全パッケージの唯一の共通依存。

## 公開 API
```ts
export const ProjectSchema: z.ZodType<Project>;      // 以下 Page, Panel, Bubble, PanelArt, FocusPoint, Vector, ReferenceImage, Stroke, Sweep, Character も個別に export
export type Project, Page, Panel, ... ;              // z.infer
export const PageDiagnosisSchema, IssueSchema;       // 診断結果の型（検証用。計算はしない）
export const PatchSchema: z.ZodType<Patch>;
export const PanelArtRequestSchema, LayoutProposalResponseSchema, CritiqueResponseSchema;   // AI 応答の検証用
export function parseProject(json: unknown): Project; // バリデーション + マイグレーション
export function migrate(json: unknown): unknown;      // schemaVersion を最新に
export function createEmptyProject(title: string): Project;   // settings は既定値（182x257mm、300dpi、既定 style）
export function createPage(template: 'blank' | '2rows' | '3rows' | '4rows', direction: ReadingDirection): Page;
export function createBubble(init: Partial<Bubble> & Pick<Bubble, 'pos'>): Bubble;   // 既定 size、shape normal
export function currentArt(panel: Panel): PanelArt | undefined;
export const fixtures: { samplePage01: Project };     // docs/fixtures/sample-page-01.json
export const newId: () => ID;                         // nanoid
```

## 制約
- 契約との差分を出さない。差分が必要なら `03-data-model.md` の PR が先。
- `refine` で参照整合を検証する: `Panel.artId` が `arts` 内に存在する、`PanelArt.parentId` が同 Panel の `arts` 内、`Vector.sourceFocusId` / `targetFocusId` が同 Panel の FocusPoint か Bubble、`Bubble.speakerId`、`FocusPoint.characterId`、`Panel.cast` が `characters` 内、`Panel.order` と `Bubble.order` がそれぞれ一意、`Rect` / `Point` / `Size` が 0..1。
- ランタイム依存は `zod` と `nanoid` のみ。React に依存しない。

## 受け入れ条件
- [ ] `docs/fixtures/sample-page-01.json` が `parseProject` を通る
- [ ] 上記の参照整合違反をそれぞれ 1 ケースずつテストで検出する
- [ ] `createPage` の各テンプレートが `OVERLAP` のない矩形を生成し、`order` が rtl 順で振られている
- [ ] `migrate` のテスト骨格がある（v1 → v1 は no-op）
- [ ] JSON Schema を `dist/schema.json` に出力する（LLM の構造化出力用）
