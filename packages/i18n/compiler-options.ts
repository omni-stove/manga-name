import { fileURLToPath } from 'node:url'
import type { CompilerOptions } from '@inlang/paraglide-js'

/** scripts/compile.ts と apps/web の Vite プラグインが同じ出力を作るための、Paraglide のコンパイル設定 */
export const compilerOptions = {
  // 呼び出し元の cwd に依らないよう、このファイルからの絶対パスにする
  project: fileURLToPath(new URL('./project.inlang', import.meta.url)),
  outdir: fileURLToPath(new URL('./src/paraglide', import.meta.url)),
  // 言語を切り替える画面がまだ無いので、Cookie などを読まず常に baseLocale にする
  strategy: ['baseLocale'],
  emitReadme: false,
  emitPrettierIgnore: false,
} satisfies CompilerOptions
