import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `projects: ['packages/*']` にしないのは、config ファイルを持たない glob プロジェクトは
    // ルートの includeSource を継承しないため。
    // `packages/*/src` のように cwd を固定しないのは、各パッケージから
    // `vitest run --config ../../vitest.config.ts` で同じ設定を使うため。
    includeSource: ['**/src/**/*.{ts,tsx}'],
  },
})
