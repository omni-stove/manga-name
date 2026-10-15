# @manga/schema

`docs/03-data-model.md` の Zod スキーマ、型、フィクスチャ、マイグレーション。全パッケージの唯一の共通依存。
仕様は `docs/workstreams/WS-01-schema.md`。ランタイム依存は `zod` と `nanoid` のみ。

```sh
pnpm --filter @manga/schema test
pnpm --filter @manga/schema typecheck
```

## 公開 API

| export | 内容 |
|---|---|
| `ProjectSchema`, `EpisodeSchema`, `PageSchema`, `PanelSchema`, `BubbleSchema`, `PanelArtSchema`, `FocusPointSchema`, `VectorSchema`, `SweepSchema`, `ReferenceImageSchema`, `StrokeSchema`, `CharacterSchema`, `ProjectSettingsSchema`, `DiagnosisConfigSchema`, `PointSchema`, `SizeSchema`, `RectSchema` | 契約のドキュメント型。同名の型を `z.infer` で export する |
| `PageDiagnosisSchema`, `PanelDiagnosisSchema`, `FocusDiagnosisSchema`, `IssueSchema` | 診断結果の検証用。計算はしない |
| `PatchSchema` | JSON Patch（add / remove / replace） |
| `PanelArtRequestSchema`, `LayoutProposalResponseSchema`, `CritiqueResponseSchema` | AI プロバイダの入出力の検証用 |
| `newId()` | nanoid |
| `SCHEMA_VERSION` | 現在の `schemaVersion` |

`ProjectBaseSchema` は refine 前の object スキーマで、`pick` が要るときだけ使う。検証には `ProjectSchema` を使う。

## 参照整合

`parse` は型の検査に加えて次を `refine` で検証する。違反は該当フィールドの `path` を持つ issue になる。

- `Panel.artId` が同 Panel の `arts` にある
- `PanelArt.parentId` が同 Panel の `arts` にある
- `Vector.sourceFocusId` / `targetFocusId` が同 Panel の FocusPoint か Bubble の ID
- `Bubble.speakerId` / `FocusPoint.characterId` が `Project.characters` にある
- `Panel.order` はページ内で、`Bubble.order` はコマ内で一意
- `Point` / `Size` / `Rect` の各成分、`FocusPoint.weight`、`ReferenceImage.opacity`、centre sweep の `y` は 0..1

## 依存の宣言

`zod` は `pnpm-workspace.yaml` の catalog から外されているため、このパッケージが直接バージョンを持つ。catalog に戻ったら `"catalog:"` に切り替える。
`tsconfig.json` の `lib` に `DOM` を足しているのは、契約の `PanelArtRequest` が `Blob` を持つため。
