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
  ],
  // apps/desktop の devUrl がこのポートを指すので、塞がっていても別のポートに逃げない
  server: { port: 5173, strictPort: true },
  // in-source のテストブロックを本番ビルドから落とす
  define: { 'import.meta.vitest': 'undefined' },
  // scripts/bundle-size.ts が初期ロードのチャンクを辿るのに使う
  build: { manifest: true },
})
