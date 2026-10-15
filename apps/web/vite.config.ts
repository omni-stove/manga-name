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
  // in-source のテストブロックを本番ビルドから落とす
  define: { 'import.meta.vitest': 'undefined' },
})
