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
      // workers/** はテストを走らせないので、含めると 0% として合計を下げる
      exclude: ['workers/**', '**/*.stories.tsx', '**/src/dev/**', '**/*.gen.ts'],
      reporter: ['text-summary', 'html'],
      // パッケージごとに今の値を床にし、テストの無いコードを足して下げた PR を止める
      thresholds: {
        'apps/web/**': { statements: 69, branches: 59, functions: 59, lines: 69 },
        'packages/ai/**': { statements: 98, branches: 92, functions: 96, lines: 98 },
        'packages/diagnosis/**': { statements: 98, branches: 91, functions: 100, lines: 100 },
        'packages/editor-canvas/**': { statements: 88, branches: 79, functions: 90, lines: 94 },
        'packages/inspector/**': { statements: 93, branches: 79, functions: 88, lines: 96 },
        'packages/render/**': { statements: 95, branches: 88, functions: 92, lines: 95 },
        'packages/schema/**': { statements: 98, branches: 93, functions: 99, lines: 99 },
        'packages/storage/**': { statements: 81, branches: 70, functions: 89, lines: 85 },
        'packages/ui/**': { statements: 61, branches: 43, functions: 53, lines: 63 },
      },
    },
  },
})
