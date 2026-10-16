import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, inspector, openPage, selectTool, waitSaved } from './app'

test('診断オーバーレイの集計行を出し、焦点を経路の外へ動かすと miss になる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)

  const summary = page.locator('[data-diagnosis="summary"]')
  await expect(summary).toHaveText('reading order OK | focus points: 12 ok 12 miss 0')
  const label = page.locator('[data-diagnosis-focus-id="fp_4_e"]')
  await expect(label).toHaveAttribute('data-status', 'ok')

  // E crouched はコマ 4 の y 0.88。コマの下端まで下げると centre sweep から 0.4 より外れ、誘導線も無い
  await selectTool(page, '焦点')
  const focus = await page.locator('[data-focus-id="fp_4_e"]').boundingBox()
  const panel = await page.locator('[data-panel-id="pn_4"]').boundingBox()
  if (!focus || !panel) throw new Error('fp_4_e or pn_4 is not rendered')
  const x = focus.x + focus.width / 2
  await page.mouse.move(x, focus.y + focus.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, panel.y + panel.height * 0.99, { steps: 8 })
  await page.mouse.up()

  await expect(summary).toHaveText('reading order OK | focus points: 12 ok 11 miss 1')
  await expect(label).toHaveAttribute('data-status', 'miss')
  await waitSaved(page)

  await inspector(page).locator('button[data-code="FOCUS_MISS"]').click()
  const form = page.locator('[data-inspector="focus"]')
  await expect(form.getByRole('heading', { name: '焦点 E crouched, still' })).toBeVisible()
  await expect(form.locator('[data-status="miss"]')).toBeVisible()
})
