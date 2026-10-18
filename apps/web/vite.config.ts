import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { compilerOptions } from '@manga/i18n/compiler-options'
import babel from '@rolldown/plugin-babel'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // ルートファイルを変換するため、router プラグインは react より前に置く
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: false,
      quoteStyle: 'single',
      semicolons: false,
    }),
    react(),
    // plugin-react の compiler オプションは Rust 移植で experimental なので、安定版の Babel プラグインを使う。
    // コンパイルできないコンポーネントは黙って最適化から外れ、Biome の useReactCompiler も構文の未対応は拾わないので、ビルドを落とす。
    // @babel/core を 7 に留めるのは、babel-plugin-react-compiler 1.0 が Babel 8 の AST では分割代入の既定値を扱えないため
    babel({ presets: [reactCompilerPreset({ panicThreshold: 'all_errors' })] }),
    // messages/*.json を変えたら dev サーバーのまま作り直すため。install 時の生成だけだと古いまま残る
    paraglideVitePlugin(compilerOptions),
  ],
  // apps/desktop の devUrl がこのポートを指すので、塞がっていても別のポートに逃げない
  server: { port: 5173, strictPort: true },
  // in-source のテストブロックを本番ビルドから落とす
  define: { 'import.meta.vitest': 'undefined' },
  build: {
    // scripts/bundle-size.ts が初期ロードのチャンクを辿るのに使う
    manifest: true,
    // 初期ロードの上限は scripts/bundle-size.ts が gzip 後の合計で見るので、圧縮前の 1 チャンクの大きさでは警告しない
    chunkSizeWarningLimit: Number.POSITIVE_INFINITY,
  },
})
