import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // workers/* は cloudflare:workers を import するので、各パッケージの vitest.config.ts
    // （vitest-pool-workers）で走らせる。ルートの node 実行には混ぜない。
    exclude: [...configDefaults.exclude, 'workers/**'],
    // `projects: ['packages/*']` にしないのは、config ファイルを持たない glob プロジェクトは
    // ルートの includeSource を継承しないため。
    // `packages/*/src` のように cwd を固定しないのは、各パッケージから
    // `vitest run --config ../../vitest.config.ts` で同じ設定を使うため。
    includeSource: ['**/src/**/*.{ts,tsx}'],
  },
})
