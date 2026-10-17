import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage } from './app'

test('エディタのヘッダーで、キーでツールとペンを選び、前後のページへ移れる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await page.getByRole('button', { name: 'ページを追加' }).click()
  await openPage(page, 1)

  const tools = page.getByRole('group', { name: 'ツール' })
  await page.keyboard.press('b')
  await expect(tools.getByRole('radio', { name: 'フキダシ' })).toBeChecked()
  await page.keyboard.press('d')
  await expect(tools.getByRole('radio', { name: '手描き' })).toBeChecked()
  await page.keyboard.press('3')
  await expect(
    page.getByRole('group', { name: 'ペン' }).getByRole('radio', { name: '青' }),
  ).toBeChecked()
  // ラジオにフォーカスがあってもキーが効く
  await tools.getByText('選択', { exact: true }).click()
  await page.keyboard.press('p')
  await expect(tools.getByRole('radio', { name: 'コマ' })).toBeChecked()

  const current = page.getByRole('combobox', { name: 'ページ' }).locator('option:checked')
  const prev = page.getByRole('button', { name: '前のページ' })
  const next = page.getByRole('button', { name: '次のページ' })
  await expect(current).toHaveText('1 / 2 ページ')
  await expect(prev).toBeDisabled()
  await page.keyboard.press(']')
  await expect(current).toHaveText('2 / 2 ページ')
  await expect(next).toBeDisabled()
  await prev.click()
  await expect(current).toHaveText('1 / 2 ページ')
  await page.getByRole('combobox', { name: 'ページ' }).selectOption({ label: '2 / 2 ページ' })
  await expect(current).toHaveText('2 / 2 ページ')
  await page.keyboard.press('[')
  await expect(current).toHaveText('1 / 2 ページ')
})
