# CONTRIBUTING

## コマンド

セットアップは [README](README.md)。`make <task>` は `mise run <task>` の別名で、タスクの一覧は `mise tasks`（`.mise/tasks.toml`）。1 パッケージだけ動かすときは `pnpm --filter @manga/<dir> <script>` で、script はそのパッケージの `package.json` にある。

## ブランチと PR

- PR は `main` 宛て。テンプレートに沿って、Issue の完了条件をチェックリストで列挙する。
- CI（lint / typecheck / test）が green でないとマージしない。
- 契約（`docs/03-data-model.md`, `docs/04-diagnosis-spec.md`）の変更は単独の PR にする。

## パッケージを追加する

ディレクトリを 1 つ足すだけで取り込まれる。`apps/*`, `packages/*`, `workers/*` が workspace に登録済み。

1. ディレクトリを作る。名前は `docs/02-architecture.md` のリポジトリ構成に合わせる。
2. `package.json` を置く。パッケージ名は `@manga/<dir>`。

   ```json
   {
     "name": "@manga/diagnosis",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "exports": { ".": "./src/index.ts" },
     "scripts": {
       "typecheck": "tsc --noEmit",
       "test": "vitest run --config ../../vitest.config.ts"
     },
     "dependencies": {
       "@manga/schema": "workspace:*"
     },
     "devDependencies": {
       "typescript": "catalog:",
       "vitest": "catalog:"
     }
   }
   ```

3. `tsconfig.json` を置く。

   ```json
   {
     "extends": "../../tsconfig.base.json",
     "include": ["src"]
   }
   ```

   React を使うパッケージは `compilerOptions` に `"jsx": "react-jsx"` と `"lib": ["ES2023", "DOM", "DOM.Iterable"]` を足す。

4. `src/index.ts` を置き、ルートで `pnpm install && pnpm check` を通す。テストは別ファイルにせず、ソース内の `if (import.meta.vitest) { ... }` ブロックに書く。

   ```ts
   export const add = (a: number, b: number) => a + b

   if (import.meta.vitest) {
     const { expect, test } = import.meta.vitest
     test('add', () => {
       expect(add(1, 2)).toBe(3)
     })
   }
   ```
5. `README.md` を置く。

### 規約

- `exports` はビルド成果物ではなく `src/index.ts` を指す。パッケージ単位の build 工程は持たない。apps と Vitest がソースを直接読む。
- 共通依存のバージョンは `pnpm-workspace.yaml` の `catalog` で揃える。`package.json` では `"catalog:"` と書く。
- `packages/*` は `@manga/schema` 以外の `packages/*` を import しない（例外は `inspector` が `@manga/ui` を使うこと）。横の連携は `apps/web` が配線する。
- `tsconfig.base.json` に `paths` は置かない。パッケージ参照は `workspace:*` 依存で行う。
- テストは in-source（`import.meta.vitest`）。ルートの `vitest.config.ts` が `**/src/**/*.{ts,tsx}` を対象にし、各パッケージの `test` スクリプトも同じファイルを `--config` で指す。パッケージ固有の設定（jsdom など）が要るときだけ、そのディレクトリに `vitest.config.ts` を置き、ルートの設定を `extends` する。
- Vite でバンドルする apps は `define: { 'import.meta.vitest': 'undefined' }` を置き、テストブロックを本番ビルドから落とす。
