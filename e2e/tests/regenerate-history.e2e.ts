import { expect, test } from '@playwright/test'
import { arts, FIXTURE_PROJECT, importProject, openPage, panelInspector, selectPanel } from './app'

test('修正指示つきで再生成し、履歴で前の絵に切り替え、Undo で戻す', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  await selectPanel(page, 1)

  const inspector = panelInspector(page)
  await inspector.getByRole('button', { name: '生成', exact: true }).click()
  await expect(arts(page)).toHaveCount(1)

  await inspector.getByLabel('修正指示').fill('もっと引きで')
  await inspector.getByRole('button', { name: '修正して再生成' }).click()
  await expect(arts(page)).toHaveCount(2)
  const [latest, first] = [arts(page).nth(0), arts(page).nth(1)]
  await expect(latest).toContainText('もっと引きで')
  await expect(latest).toHaveAttribute('data-current', 'true')

  await first.locator('button[aria-pressed]').click()
  await expect(first).toHaveAttribute('data-current', 'true')
  await expect(latest).not.toHaveAttribute('data-current')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(latest).toHaveAttribute('data-current', 'true')
  await expect(first).not.toHaveAttribute('data-current')
})
