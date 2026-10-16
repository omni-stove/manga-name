import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** `pnpm --filter @manga/inspector dev` で開くプレイグラウンド */
export default defineConfig({
  root: 'src/dev',
  plugins: [react()],
  // in-source のテストブロックをプレイグラウンドのバンドルから落とす
  define: { 'import.meta.vitest': 'undefined' },
})
