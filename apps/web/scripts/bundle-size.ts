/**
 * `vite build` の成果物から、エディタを開くまでに読み込む JS と CSS（index.html から静的 import で辿れるもの）の
 * gzip 後の合計を測り、502KB を超えるか、フォントを最初から読み込んでいたら終了コード 1 で終わる。
 * `pnpm --filter @manga/web size` で、ビルドしてから実行する。
 */
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const BUDGET = 502 * 1024
const FONT = /\.(ttf|otf|woff2?)\b/

interface ManifestChunk {
  file: string
  imports?: string[]
  css?: string[]
}

const dist = new URL('../dist/', import.meta.url)
const manifest: Record<string, ManifestChunk> = JSON.parse(
  await readFile(new URL('.vite/manifest.json', dist), 'utf8'),
)

// 動的 import の先は画面を開いた後に要るまで読まないので数えない
const files = new Set<string>()
const visit = (key: string) => {
  const chunk = manifest[key]
  if (!chunk || files.has(chunk.file)) return
  files.add(chunk.file)
  for (const css of chunk.css ?? []) files.add(css)
  for (const imported of chunk.imports ?? []) visit(imported)
}
visit('index.html')

const html = await readFile(new URL('index.html', dist), 'utf8')
const rows: { file: string; gzip: number }[] = []
const eagerFonts: string[] = FONT.test(html) ? ['index.html'] : []
for (const file of files) {
  const source = await readFile(new URL(file, dist))
  rows.push({ file, gzip: gzipSync(source, { level: 9 }).length })
  // 初期の CSS に @font-face があると、UI の文字を描く時点で数 MB のフォントを取りに行く
  if (file.endsWith('.css') && FONT.test(source.toString('utf8'))) eagerFonts.push(file)
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`
const total = rows.reduce((sum, row) => sum + row.gzip, 0)
for (const row of rows.sort((a, b) => b.gzip - a.gzip))
  console.log(`${kb(row.gzip).padStart(10)}  ${row.file}`)
console.log(`${kb(total).padStart(10)}  合計（gzip、上限 ${kb(BUDGET)}）`)

let failed = false
if (total > BUDGET) {
  console.error(`初期ロードが上限を ${kb(total - BUDGET)} 超えている`)
  failed = true
}
if (eagerFonts.length > 0) {
  console.error(`フォントを初期ロードで読み込んでいる: ${eagerFonts.join(', ')}`)
  failed = true
}
if (failed) process.exit(1)
