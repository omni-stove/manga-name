import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage } from './app'

test('キャンバスの何も無いところを右クリックしてメニューから操作できる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await page.getByRole('button', { name: 'ページを追加' }).click()
  await openPage(page, 1)

  const canvas = page.getByRole('application', { name: 'キャンバス' })
  const menu = page.getByRole('menu', { name: 'ページのメニュー' })
  // 左上の隅は作業台
  await canvas.click({ button: 'right', position: { x: 4, y: 4 } })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: '前のページ' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  await canvas.click({ button: 'right', position: { x: 4, y: 4 } })
  await menu.getByRole('menuitem', { name: '次のページ' }).click()
  await expect(menu).toBeHidden()
  await expect(page.getByRole('combobox', { name: 'ページ' }).locator('option:checked')).toHaveText(
    '2 / 2 ページ',
  )
})
