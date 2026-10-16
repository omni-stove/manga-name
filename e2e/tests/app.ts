import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page } from '@playwright/test'

/** 6 コマ、右綴じ 1 ページのフィクスチャ。Fake の生成結果は docs/fixtures/art と同じバイト列になる */
export const FIXTURE_PROJECT = fileURLToPath(
  new URL('../../docs/fixtures/sample-page-01.json', import.meta.url),
)

/** packages/render のテストが描いた、フィクスチャに docs/fixtures/art を採用させたページ（コマ番号つき） */
export const RENDER_SNAPSHOT_ARTS = fileURLToPath(
  new URL('../../packages/render/src/__snapshots__/page-arts.png', import.meta.url),
)

/** 一覧からプロジェクトを作り、ページ一覧に移る */
export async function createProject(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByLabel('タイトル').fill(title)
  await page.getByRole('button', { name: '新規作成' }).click()
  await expect(page.getByRole('heading', { name: 'ページ一覧' })).toBeVisible()
}

/** 一覧のファイル選択からプロジェクト JSON を読み込み、ページ一覧に移る */
export async function importProject(page: Page, file: string): Promise<void> {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(page.getByRole('heading', { name: 'ページ一覧' })).toBeVisible()
}

/** ページ一覧から n ページ目のエディタを開く */
export async function openPage(page: Page, n: number): Promise<void> {
  await page.getByRole('link', { name: `${n} ページ` }).click()
  await expect(canvas(page)).toBeVisible()
}

const canvas = (page: Page): Locator => page.getByRole('application', { name: 'キャンバス' })

export const inspector = (page: Page): Locator => page.locator('aside')

export const panelInspector = (page: Page): Locator => page.locator('[data-inspector="panel"]')

/** コマのインスペクタの履歴。新しい順に並ぶ */
export const arts = (page: Page): Locator => panelInspector(page).locator('li[data-art-id]')

/** ツールバーのツールを切り替える */
export async function selectTool(page: Page, label: string): Promise<void> {
  await page.getByRole('group', { name: 'ツール' }).getByText(label, { exact: true }).click()
}

/** インスペクタの要素リストからコマを選ぶ。カメラが入っていると名前の後ろに続く */
export async function selectPanel(page: Page, order: number): Promise<void> {
  await inspector(page)
    .getByRole('button', { name: new RegExp(`^コマ ${order}( |$)`) })
    .click()
  await expect(panelInspector(page).getByRole('heading', { name: `コマ ${order}` })).toBeVisible()
}

/** キャンバスの n 番目に描かれたコマの中を、左上寄りの点でクリックする */
export async function clickInsidePanel(page: Page, index: number): Promise<void> {
  const box = await page.locator('[data-panel-id]').nth(index).boundingBox()
  if (!box) throw new Error(`panel ${index} is not rendered`)
  // 中央は空のコマの案内、右下はホバーで出る生成ボタンなので避ける
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3)
}

/** debounce 待ちの変更が storage に書かれるまで待つ */
export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible()
}

/** 書き出しダイアログから PNG を保存し、ダウンロードされたバイト列を返す */
export async function exportPng(
  page: Page,
  opts: { panelNumbers?: boolean } = {},
): Promise<Buffer> {
  await page.getByRole('button', { name: '書き出し', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'このページを PNG で保存' })
  await dialog.getByLabel('コマ番号を入れる').setChecked(opts.panelNumbers ?? false)
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '保存' }).click()
  const file = await (await download).path()
  return readFile(file)
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** PNG の IHDR から画素の幅と高さを読む。PNG でなければ throw する */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/**
 * 2 枚の PNG を同じ幅に縮めてグレースケールで比べ、画素差の平均と最大（0〜255）を返す。
 * 書き出しは 300dpi、レンダラのスナップショットは幅 728px で、ブラウザと @napi-rs/canvas では
 * 文字のアンチエイリアスも違うので、縮めてから比べる
 */
export async function comparePng(
  page: Page,
  a: Buffer,
  b: Buffer,
  width = 91,
): Promise<{ mean: number; max: number }> {
  return page.evaluate(
    async ({ a, b, width }) => {
      const decode = async (base64: string) =>
        (await fetch(`data:image/png;base64,${base64}`)).blob()
      const [blobA, blobB] = await Promise.all([decode(a), decode(b)])
      const full = await createImageBitmap(blobA)
      // 丸めで 1px ずれないよう、高さは 1 枚目から決めて両方に使う
      const height = Math.round((full.height * width) / full.width)
      const gray = async (blob: Blob) => {
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: 'high',
        })
        const ctx = new OffscreenCanvas(width, height).getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        ctx.drawImage(bitmap, 0, 0)
        const { data } = ctx.getImageData(0, 0, width, height)
        const out = new Float64Array(width * height)
        for (let i = 0; i < out.length; i++) {
          out[i] =
            0.299 * (data[i * 4] ?? 0) +
            0.587 * (data[i * 4 + 1] ?? 0) +
            0.114 * (data[i * 4 + 2] ?? 0)
        }
        return out
      }
      const [x, y] = await Promise.all([gray(blobA), gray(blobB)])
      let sum = 0
      let max = 0
      for (let i = 0; i < x.length; i++) {
        const d = Math.abs((x[i] ?? 0) - (y[i] ?? 0))
        sum += d
        max = Math.max(max, d)
      }
      return { mean: sum / x.length, max }
    },
    { a: a.toString('base64'), b: b.toString('base64'), width },
  )
}
