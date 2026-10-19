import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage } from './app'

test('選んだフキダシをキーでコピーして貼り付けると、ずれた位置にフキダシが増える', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  // 焦点とベクトルはフキダシより先に拾うので、隠しておく
  await page
    .getByRole('group', { name: m.web_editor_layers() })
    .getByLabel(m.web_editor_layer_hints())
    .uncheck()

  const bubbles = page.locator('[data-bubble-id]')
  const ids = () => bubbles.evaluateAll((els) => els.map((el) => el.getAttribute('data-bubble-id')))
  const before = await ids()
  const box = await bubbles.first().boundingBox()
  if (!box) throw new Error('bubble is not rendered')
  // フキダシの上にはコマのホバー用の透明な当たり判定が重なるので座標で押す
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.press('ControlOrMeta+C')
  await page.keyboard.press('ControlOrMeta+V')
  await expect(bubbles).toHaveCount(before.length + 1)

  const added = (await ids()).find((id) => !before.includes(id))
  const pasted = await page.locator(`[data-bubble-id="${added}"]`).boundingBox()
  if (!pasted) throw new Error('pasted bubble is not rendered')
  expect(pasted.x).toBeGreaterThan(box.x)

  await page.keyboard.press('ControlOrMeta+V')
  await expect(bubbles).toHaveCount(before.length + 2)
})

test('コマを右クリックメニューからコピーして、ページのメニューから貼り付けられる', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)

  const panels = page.locator('[data-panel-id]')
  const count = await panels.count()
  const box = await panels.first().boundingBox()
  if (!box) throw new Error('panel is not rendered')
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3, { button: 'right' })
  await page
    .getByRole('menu', { name: m.web_editor_menu_panel() })
    .getByRole('menuitem', { name: m.copy() })
    .click()

  const canvas = page.getByRole('application', { name: m.web_editor_canvas() })
  await canvas.click({ button: 'right', position: { x: 4, y: 4 } })
  await page
    .getByRole('menu', { name: m.web_editor_page_menu() })
    .getByRole('menuitem', { name: m.paste() })
    .click()
  await expect(panels).toHaveCount(count + 1)
})
