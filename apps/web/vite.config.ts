import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { compilerOptions } from '@manga/i18n/compiler-options'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
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
