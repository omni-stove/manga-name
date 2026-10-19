import { m } from '@manga/i18n'
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
  const addPage = page.getByRole('button', { name: m.web_episode_add_page() })
  await addPage.click()
  await expect(
    page.getByRole('link', { name: m.web_episode_page_number({ number: 2 }) }),
  ).toBeVisible()
  await addPage.click()
  await openPage(page, 3)

  // 3 ページ目だけ絵を入れ、見開きの左右を画像の明るさで見分ける
  const generateAll = page.getByRole('button', { name: m.inspector_page_generate_all() })
  await generateAll.click()
  await expect(generateAll).toBeEnabled()
  const panels = await page.locator('[data-panel-id]').count()
  await expect(page.locator('[data-panel-id] image')).toHaveCount(panels)

  let dialog = await openExportDialog(page)
  await dialog.getByLabel(m.web_export_format()).selectOption('pdf')
  await dialog.getByLabel(m.web_export_range()).selectOption('all')
  await dialog.getByLabel(m.web_export_spread()).check()
  await expect(dialog.getByRole('status')).toHaveText(
    new RegExp(m.web_export_missing_arts({ count: '\\d+' })),
  )
  const spread = await readPdfSheets(await submitExport(page, dialog))

  // 1 ページ目は相方の無い見開きで、2 と 3 ページ目が 1 枚の見開き。どちらの紙面も 2 ページ分の幅
  expect(spread).toHaveLength(2)
  const [cover, pair] = spread
  const half = (pair?.width ?? 0) / 2
  expect(cover?.width).toBeCloseTo(pair?.width ?? 0, 0)
  expect(cover?.images).toHaveLength(1)
  expect(cover?.images[0]?.x).toBeCloseTo(0, 0)
  expect(cover?.images[0]?.width).toBeCloseTo(half, 0)
  const [left, right] = [...(pair?.images ?? [])].sort((a, b) => a.x - b.x)
  expect(left?.x).toBeCloseTo(0, 0)
  expect(right?.x).toBeCloseTo(half, 0)
  // 右綴じは奇数ページが左。絵の入った 3 ページ目のほうが、枠だけの 2 ページ目より暗い
  expect(left?.brightness ?? 255).toBeLessThan(right?.brightness ?? 0)

  dialog = await openExportDialog(page)
  await dialog.getByLabel(m.web_export_format()).selectOption('pdf')
  await dialog.getByLabel(m.web_export_range()).selectOption('custom')
  await dialog.getByLabel(m.web_export_from_page()).fill('2')
  await dialog.getByLabel(m.web_export_to_page()).fill('3')
  await dialog.getByLabel(m.panel_note()).selectOption('sheet')
  const withNotes = await readPdfSheets(await submitExport(page, dialog))

  // 2 ページ分の紙面と、それぞれの後ろの指示メモページ
  expect(withNotes).toHaveLength(4)
  for (const sheet of withNotes) expect(sheet.images).toHaveLength(1)
})
