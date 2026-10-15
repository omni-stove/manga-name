# @manga/schema

`docs/03-data-model.md` の Zod スキーマ、型、フィクスチャ、マイグレーション。全パッケージの唯一の共通依存。
仕様は `docs/workstreams/WS-01-schema.md`、公開 API は `src/index.ts`。ランタイム依存は `zod` と `nanoid` のみ。

```sh
pnpm --filter @manga/schema test
pnpm --filter @manga/schema typecheck
```

`zod` は `pnpm-workspace.yaml` の catalog から外されているため、このパッケージが直接バージョンを持つ。catalog に戻ったら `"catalog:"` に切り替える。
`tsconfig.json` の `lib` に `DOM` を足しているのは、契約の `PanelArtRequest` が `Blob` を持つため。
