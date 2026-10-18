import { expect, test } from '@playwright/test'
import { FIXTURE_EPISODE, FIXTURE_PROJECT, importProject, openPage } from './app'

test('ページのコマ割りをテンプレートに登録し、そのテンプレートでページを足して、確認を経て登録を消せる', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  // 左上の隅は作業台
  await page
    .getByRole('application', { name: 'キャンバス' })
    .click({ button: 'right', position: { x: 4, y: 4 } })
  await page.getByRole('menuitem', { name: 'コマ割りをテンプレートに登録…' }).click()
  const register = page.getByRole('dialog', { name: 'コマ割りをテンプレートに登録' })
  await register.getByLabel('テンプレート名').fill('6 コマの基本')
  await register.getByRole('button', { name: '登録' }).click()
  await expect(register).toBeHidden()
  await expect(page.getByText('「6 コマの基本」をテンプレートに登録しました')).toBeVisible()

  await page.getByRole('link', { name: FIXTURE_EPISODE }).click()
  const template = page.getByLabel('テンプレート')
  await template.selectOption({ label: '6 コマの基本' })
  await page.getByRole('button', { name: 'ページを追加' }).click()
  const added = page.getByRole('listitem').filter({ hasText: '2 ページ' })
  await expect(added).toContainText('コマ 6')

  await page.getByRole('button', { name: 'テンプレートを削除' }).click()
  const dialog = page.getByRole('dialog', { name: 'テンプレートを削除' })
  await expect(dialog).toContainText('「6 コマの基本」')
  await dialog.getByRole('button', { name: '削除' }).click()
  await expect(template.locator('option', { hasText: '6 コマの基本' })).toHaveCount(0)
  await expect(template).toHaveValue('3rows')
})
