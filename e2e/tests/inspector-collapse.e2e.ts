import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, inspector, openPage } from './app'

test('インスペクタを畳むとキャンバスが広がり、開閉は再読み込みしても残る', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  const canvas = page.getByRole('application', { name: 'キャンバス' })
  const outline = inspector(page).getByRole('button', { name: /^コマ 1( |$)/ })
  await expect(outline).toBeVisible()
  const before = (await canvas.boundingBox())?.width ?? 0

  await page.getByRole('button', { name: 'インスペクタを畳む' }).click()
  await expect(outline).toBeHidden()
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(before)

  await page.reload()
  await expect(page.getByRole('button', { name: 'インスペクタを開く' })).toBeVisible()
  await expect(outline).toBeHidden()

  await page.getByRole('button', { name: 'インスペクタを開く' }).click()
  await expect(outline).toBeVisible()
})
