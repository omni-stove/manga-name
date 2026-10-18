import babel from '@rolldown/plugin-babel'
import { reactCompilerPreset } from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  // apps/web のビルドと同じく React Compiler を通し、テストと本番で描画の振る舞いを揃える
  plugins: [babel({ presets: [reactCompilerPreset({ panicThreshold: 'all_errors' })] })],
  test: {
    // workers/* は cloudflare:workers を import するので、各パッケージの vitest.config.ts
    // （@cloudflare/vitest-plugin）で走らせる。ルートの node 実行には混ぜない。
    exclude: [...configDefaults.exclude, 'workers/**'],
    // `projects: ['packages/*']` にしないのは、config ファイルを持たない glob プロジェクトは
    // ルートの includeSource を継承しないため。
    // `packages/*/src` のように cwd を固定しないのは、各パッケージから
    // `vitest run --config ../../vitest.config.ts` で同じ設定を使うため。
    includeSource: ['**/src/**/*.{ts,tsx}'],
    // Node 26 は --localstorage-file が無いとメソッドの無い localStorage を置き、触るたびに警告する。
    // テストは jsdom の localStorage か差し替えた Storage を使うので、Node のものは消す
    execArgv: ['--no-webstorage'],
    coverage: {
      provider: 'v8',
      include: ['**/src/**/*.{ts,tsx}'],
      exclude: ['**/*.stories.tsx', '**/src/dev/**', '**/*.gen.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
})
