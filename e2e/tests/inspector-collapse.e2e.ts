import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, inspector, openPage } from './app'

test('インスペクタを畳むとキャンバスが広がり、開閉は再読み込みしても残る', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  const canvas = page.getByRole('application', { name: m.web_editor_canvas() })
  const outline = inspector(page).getByRole('button', {
    name: new RegExp(`^${m.web_editor_outline_panel({ order: 1 })}( |$)`),
  })
  await expect(outline).toBeVisible()
  const before = (await canvas.boundingBox())?.width ?? 0

  await page
    .getByRole('button', { name: m.ui_sidebar_collapse({ title: m.web_editor_inspector() }) })
    .click()
  await expect(outline).toBeHidden()
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(before)

  await page.reload()
  await expect(
    page.getByRole('button', { name: m.ui_sidebar_expand({ title: m.web_editor_inspector() }) }),
  ).toBeVisible()
  await expect(outline).toBeHidden()

  await page
    .getByRole('button', { name: m.ui_sidebar_expand({ title: m.web_editor_inspector() }) })
    .click()
  await expect(outline).toBeVisible()
})
