import { expect, test } from '@playwright/test'
import {
  FIXTURE_PROJECT,
  importProject,
  openExportDialog,
  openPage,
  readPdfSheets,
  submitExport,
} from './app'

test('3 ページを PDF に書き出し、見開きでは右綴じの奇数ページが左に来て、範囲と指示メモページでページ数が変わる', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  const addPage = page.getByRole('button', { name: 'ページを追加' })
  await addPage.click()
  await expect(page.getByRole('link', { name: '2 ページ' })).toBeVisible()
  await addPage.click()
  await openPage(page, 3)

  // 3 ページ目だけ絵を入れ、見開きの左右を画像の明るさで見分ける
  const generateAll = page.getByRole('button', { name: 'このページを全部生成' })
  await generateAll.click()
  await expect(generateAll).toBeEnabled()
  const panels = await page.locator('[data-panel-id]').count()
  await expect(page.locator('[data-panel-id] image')).toHaveCount(panels)

  let dialog = await openExportDialog(page)
  await dialog.getByLabel('形式').selectOption('pdf')
  await dialog.getByLabel('範囲').selectOption('all')
  await dialog.getByLabel('見開きでまとめる').check()
  await expect(dialog.getByRole('status')).toContainText('未生成のコマ')
  const spread = await readPdfSheets(await submitExport(page, dialog))

  // 1 ページ目は単独、2 と 3 ページ目が 1 枚の見開き
  expect(spread).toHaveLength(2)
  const [cover, pair] = spread
  expect(cover?.images).toHaveLength(1)
  expect(pair?.width).toBeCloseTo((cover?.width ?? 0) * 2, 0)
  const [left, right] = [...(pair?.images ?? [])].sort((a, b) => a.x - b.x)
  expect(left?.x).toBeCloseTo(0, 0)
  expect(right?.x).toBeCloseTo(cover?.width ?? 0, 0)
  // 右綴じは奇数ページが左。絵の入った 3 ページ目のほうが、枠だけの 2 ページ目より暗い
  expect(left?.brightness ?? 255).toBeLessThan(right?.brightness ?? 0)

  dialog = await openExportDialog(page)
  await dialog.getByLabel('形式').selectOption('pdf')
  await dialog.getByLabel('範囲').selectOption('custom')
  await dialog.getByLabel('開始ページ').fill('2')
  await dialog.getByLabel('終了ページ').fill('3')
  await dialog.getByLabel('指示メモ').selectOption('sheet')
  const withNotes = await readPdfSheets(await submitExport(page, dialog))

  // 2 ページ分の紙面と、それぞれの後ろの指示メモページ
  expect(withNotes).toHaveLength(4)
  for (const sheet of withNotes) expect(sheet.images).toHaveLength(1)
})
