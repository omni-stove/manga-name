import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_EPISODE, FIXTURE_PROJECT, importProject, openPage } from './app'

test('ページのコマ割りをテンプレートに登録し、そのテンプレートでページを足して、確認を経て登録を消せる', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  // 左上の隅は作業台
  await page
    .getByRole('application', { name: m.web_editor_canvas() })
    .click({ button: 'right', position: { x: 4, y: 4 } })
  await page.getByRole('menuitem', { name: m.web_editor_menu_register_layout() }).click()
  const register = page.getByRole('dialog', { name: m.web_layout_template_register_title() })
  await register.getByLabel(m.layout_template_name()).fill('6 コマの基本')
  await register.getByRole('button', { name: m.web_layout_template_register() }).click()
  await expect(register).toBeHidden()
  await expect(
    page.getByText(m.web_layout_template_registered({ name: '6 コマの基本' })),
  ).toBeVisible()

  await page.getByRole('link', { name: FIXTURE_EPISODE }).click()
  const template = page.getByLabel(m.layout_template())
  await template.selectOption({ label: '6 コマの基本' })
  await page.getByRole('button', { name: m.web_episode_add_page() }).click()
  const added = page
    .getByRole('listitem')
    .filter({ hasText: m.web_episode_page_number({ number: 2 }) })
  await expect(added).toContainText(m.web_episode_page_summary({ panels: 6 }))

  await page.getByRole('button', { name: m.web_episode_remove_template() }).click()
  const dialog = page.getByRole('dialog', { name: m.web_episode_remove_template() })
  await expect(dialog).toContainText(
    m.web_episode_remove_template_confirm({ name: '6 コマの基本' }),
  )
  await dialog.getByRole('button', { name: m.remove() }).click()
  await expect(template.locator('option', { hasText: '6 コマの基本' })).toHaveCount(0)
  await expect(template).toHaveValue('3rows')
})
