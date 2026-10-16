/**
 * ビルド済みの dist を `vite preview` で配り、フィクスチャのプロジェクトを読み込んだエディタ画面を Lighthouse
 * （デスクトップ設定）で測る。TTI が 3 秒を超えたら終了コード 1 で終わる。レポートは dist/lighthouse/ に書く。
 * インストール済みの Chrome を使う。`pnpm --filter @manga/web lighthouse` で、ビルドしてから実行する。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import lighthouse from 'lighthouse'
import desktopConfig from 'lighthouse/core/config/desktop-config.js'
import puppeteer from 'puppeteer-core'
import { preview } from 'vite'

const TTI_BUDGET_MS = 3000
const FIXTURE = fileURLToPath(
  new URL('../../../docs/fixtures/sample-page-01.json', import.meta.url),
)
const out = new URL('../dist/lighthouse/', import.meta.url)

const server = await preview({
  root: fileURLToPath(new URL('..', import.meta.url)),
  preview: { port: 4175, strictPort: true },
})
const browser = await puppeteer.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  const base = server.resolvedUrls?.local[0]
  if (!base) throw new Error('preview の URL が取れない')

  // プロジェクトは IndexedDB にしかないので、同じブラウザで読み込んでから測り、Lighthouse には消させない
  await page.goto(base)
  const input = await page.waitForSelector('input[type="file"]')
  await input?.uploadFile(FIXTURE)
  await page.locator('::-p-text(ページ一覧)').wait()
  await page.locator('a::-p-text(1 ページ)').click()
  await page.locator('[aria-label="キャンバス"]').wait()
  const editorUrl = page.url()

  const result = await lighthouse(
    editorUrl,
    { output: ['html', 'json'], logLevel: 'error', disableStorageReset: true },
    desktopConfig,
    page,
  )
  if (!result) throw new Error('Lighthouse の結果がない')

  await mkdir(out, { recursive: true })
  const [html, json] = result.report as string[]
  await writeFile(new URL('editor.html', out), html ?? '')
  await writeFile(new URL('editor.json', out), json ?? '')

  const tti = result.lhr.audits.interactive?.numericValue
  if (tti === undefined) throw new Error('TTI が測れていない')
  console.log(`エディタ画面の TTI: ${Math.round(tti)} ms（上限 ${TTI_BUDGET_MS} ms）`)
  if (tti > TTI_BUDGET_MS) process.exitCode = 1
} finally {
  await browser.close()
  await server.close()
}
