# CONTRIBUTING

## コマンド

1 パッケージだけ動かすときは `pnpm --filter @manga/<dir> <script>`。

## ブランチと PR

- PR は `main` 宛て。Issue の完了条件をチェックリストで列挙する。
- CI が green でないとマージしない。

## パッケージを追加する

`apps/*`, `packages/*`, `workers/*` に既存のパッケージ（例: `packages/diagnosis`）を写してディレクトリを足し、パッケージ名を `@manga/<dir>` にする。

### 規約

- パッケージ単位の build 工程は持たない。`exports` は `src/index.ts` を指し、apps と Vitest がソースを直接読む。
- `packages/*` は `@manga/schema` と `@manga/i18n` 以外の `packages/*` を import しない（例外は `inspector` と `editor-canvas` が `@manga/ui` を使うこと）。横の連携は `apps/web` が配線する。`biome.json` の `noRestrictedImports` がこれを見る。
- テストは別ファイルにせず、ソース内の `if (import.meta.vitest) { ... }` に書く。
- 仕様は設計書に分けず、それを実装するコードの JSDoc に書く。まとめて読むときは `mise run spec`。
