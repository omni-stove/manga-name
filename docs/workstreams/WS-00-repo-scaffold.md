# WS-00 repo scaffold

Phase 1 / 開発中の依存: なし

## 目的
モノレポの骨組みを作り、各 WS のパッケージを取り込める状態にする。他 WS はこれを待たずに自分のパッケージを単体で始めてよい。

## 成果物
- pnpm workspaces。`apps/*`, `packages/*`, `workers/*` を登録。Turborepo は入れない（パッケージ単位の build がなく、CI 短縮に効かないため。`02-architecture.md` 参照）。
- 共通 `tsconfig.base.json`（strict、`moduleResolution: bundler`、`paths` なし。パッケージ参照は workspace 依存で行う）。
- Biome 設定。`pnpm lint`, `pnpm format`。
- Vitest のルート設定。`pnpm test` で全パッケージ実行。
- GitHub Actions: push で lint / typecheck / test。
- `packages/schema` の空パッケージ（WS-01 が中身を入れる）。
- パッケージ名の規約: `@manga/<dir>`。例 `@manga/schema`, `@manga/render`。
- `CONTRIBUTING.md`: ブランチ規約、PR テンプレート（受け入れ条件のチェックリスト）。

## 受け入れ条件
- [x] `pnpm install && pnpm test && pnpm lint && pnpm typecheck` が空パッケージ構成で通る
- [ ] CI が green
- [x] 各 WS がパッケージを 1 ディレクトリ追加するだけで取り込める（`CONTRIBUTING.md` に手順）
