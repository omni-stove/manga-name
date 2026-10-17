# CONTRIBUTING

## コマンド

セットアップは [README](README.md)。`make <task>` は `mise run <task>` の別名で、タスクの一覧は `mise tasks`。1 パッケージだけ動かすときは `pnpm --filter @manga/<dir> <script>`。

## ブランチと PR

- PR は `main` 宛て。Issue の完了条件をチェックリストで列挙する。
- CI が green でないとマージしない。

## パッケージを追加する

`apps/*`, `packages/*`, `workers/*` に既存のパッケージ（例: `packages/diagnosis`）を写してディレクトリを足し、パッケージ名を `@manga/<dir>` にする。

### 規約

- パッケージ単位の build 工程は持たない。`exports` は `src/index.ts` を指し、apps と Vitest がソースを直接読む。
- `packages/*` は `@manga/schema` 以外の `packages/*` を import しない（例外は `inspector` が `@manga/ui` を使うこと）。横の連携は `apps/web` が配線する。
- テストは別ファイルにせず、ソース内の `if (import.meta.vitest) { ... }` に書く。
