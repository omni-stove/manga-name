import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage } from './app'

test('エディタからナビの設定を開いて閉じると、同じページに戻る', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  const editor = page.url()
  const nav = page.getByRole('navigation', { name: m.web_nav_label() })

  await nav.getByRole('link', { name: m.web_nav_settings(), exact: true }).click()
  const project = page.getByRole('dialog', { name: m.web_project_settings() })
  await expect(project.getByLabel(m.web_dpi())).toBeVisible()
  await project.getByRole('button', { name: m.close() }).click()
  await expect(project).toBeHidden()
  await expect(page).toHaveURL(editor)

  await nav.getByRole('link', { name: m.web_app_settings() }).click()
  const app = page.getByRole('dialog', { name: m.web_app_settings() })
  await expect(app.getByRole('group', { name: m.web_settings_theme() })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(app).toBeHidden()
  await expect(page).toHaveURL(editor)
})
