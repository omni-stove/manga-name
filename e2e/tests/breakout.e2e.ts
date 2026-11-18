import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage, waitSaved } from './app'

test('コマの右クリックからはみ出しの多角形を描き、読み込み直しても残り、メニューから消せる', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)

  const pn2 = await page.locator('[data-panel-id="pn_2"]').boundingBox()
  if (!pn2) throw new Error('pn_2 is not rendered')
  const menu = page.getByRole('menu', { name: m.web_editor_menu_panel() })
  await page.mouse.click(pn2.x + pn2.width * 0.5, pn2.y + pn2.height * 0.5, { button: 'right' })
  await menu.getByRole('menuitem', { name: m.web_canvas_menu_panel_draw_breakout() }).click()

  // pn_2 の上辺をまたいで、上の間白と pn_1 まで伸ばした帯
  const vertices = [
    { x: pn2.x + pn2.width * 0.4, y: pn2.y - pn2.height * 0.3 },
    { x: pn2.x + pn2.width * 0.6, y: pn2.y - pn2.height * 0.3 },
    { x: pn2.x + pn2.width * 0.6, y: pn2.y + pn2.height * 0.4 },
    { x: pn2.x + pn2.width * 0.4, y: pn2.y + pn2.height * 0.4 },
  ]
  for (const v of vertices) await page.mouse.click(v.x, v.y)
  await expect(page.locator('[data-breakout-vertex]')).toHaveCount(4)
  const first = vertices[0] as { x: number; y: number }
  await page.mouse.click(first.x, first.y)
  await expect(page.locator('[data-draft-breakout]')).toHaveCount(0)
  const guide = page.locator('[data-panel-id="pn_2"] [data-breakout-guide]')
  await expect(guide).toHaveCount(1)
  // 頂点を置くクリックでコマを作ったり選び直したりしない
  await expect(page.locator('[data-panel-id]')).toHaveCount(6)
  const points = await guide.getAttribute('points')
  await waitSaved(page)

  await page.reload()
  await expect(page.locator('[data-panel-id="pn_2"] [data-breakout-guide]')).toHaveAttribute(
    'points',
    points ?? '',
  )

  await page.mouse.click(pn2.x + pn2.width * 0.8, pn2.y + pn2.height * 0.8, { button: 'right' })
  await menu.getByRole('menuitem', { name: m.web_canvas_menu_panel_remove_breakout() }).click()
  await expect(page.locator('[data-breakout-guide]')).toHaveCount(0)
})

test('はみ出しを描いている途中の Escape は何も残さない', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)

  const pn2 = await page.locator('[data-panel-id="pn_2"]').boundingBox()
  if (!pn2) throw new Error('pn_2 is not rendered')
  await page.mouse.click(pn2.x + pn2.width * 0.5, pn2.y + pn2.height * 0.5, { button: 'right' })
  await page
    .getByRole('menu', { name: m.web_editor_menu_panel() })
    .getByRole('menuitem', { name: m.web_canvas_menu_panel_draw_breakout() })
    .click()
  await page.mouse.click(pn2.x + pn2.width * 0.2, pn2.y + pn2.height * 0.2)
  await page.mouse.click(pn2.x + pn2.width * 0.8, pn2.y + pn2.height * 0.2)
  await expect(page.locator('[data-breakout-vertex]')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-draft-breakout]')).toHaveCount(0)
  await expect(page.locator('[data-breakout-guide]')).toHaveCount(0)
})
