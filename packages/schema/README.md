# @manga/schema

`docs/03-data-model.md` の Zod スキーマ、型、フィクスチャ、マイグレーション。全パッケージの唯一の共通依存。
中身は WS-01 が入れる。仕様は `docs/workstreams/WS-01-schema.md`。

```sh
pnpm --filter @manga/schema test
pnpm --filter @manga/schema typecheck
```
