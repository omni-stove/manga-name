import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage } from './app'

test('ページの脚本からコマ割りの案を出し、確かめて今のコマを置き換え、Undo で戻す', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  const elements = page.getByText(/^要素（\d+）$/)
  await expect(elements).toHaveText('要素（6）')

  const suggest = page.getByRole('button', { name: '脚本からコマ割りを提案' })
  await expect(suggest).toBeDisabled()
  await page.getByLabel('このページの脚本').fill('結晶の森。E が奥へ歩いていく。\nE「……ここか」')
  await suggest.click()

  const options = page.locator('[data-layout-option]')
  await expect(options).toHaveCount(2)
  await expect(options.first()).toContainText('案 1（コマ 3）')

  // フィクスチャのページは絵とフキダシがあるので、置き換える前に確かめる
  await options.first().getByRole('button', { name: 'このコマ割りにする' }).click()
  const dialog = page.getByRole('dialog', { name: 'コマ割りを置き換えますか？' })
  await dialog.getByRole('button', { name: 'このコマ割りにする' }).click()
  await expect(elements).toHaveText('要素（3）')
  await expect(page.getByLabel('このページの脚本')).toHaveValue(/……ここか/)

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(elements).toHaveText('要素（6）')
})
