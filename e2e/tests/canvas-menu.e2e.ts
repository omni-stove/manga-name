import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage, panelInspector } from './app'

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

test('コマを右クリックすると選ばれ、そのコマへの操作が出る', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)

  const panels = page.locator('[data-panel-id]')
  const count = await panels.count()
  const box = await panels.first().boundingBox()
  if (!box) throw new Error('panel is not rendered')
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'コマのメニュー' })
  await expect(menu).toBeVisible()
  await expect(panelInspector(page)).toBeVisible()
  await menu.getByRole('menuitem', { name: '削除' }).click()
  await expect(panels).toHaveCount(count - 1)
})

test('フキダシを右クリックして形を変えられる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  // 焦点とベクトルはフキダシより先に拾うので、隠しておく
  await page.getByRole('group', { name: 'レイヤー' }).getByLabel('ヒント').uncheck()

  const id = await page
    .locator('[data-bubble-id][data-shape="normal"]')
    .first()
    .getAttribute('data-bubble-id')
  const bubble = page.locator(`[data-bubble-id="${id}"]`)
  // フキダシの上にはコマのホバー用の透明な当たり判定が重なり、要素へのクリックはそこに阻まれるので座標で押す
  const box = await bubble.boundingBox()
  if (!box) throw new Error('bubble is not rendered')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await page
    .getByRole('menu', { name: 'フキダシのメニュー' })
    .getByRole('menuitem', { name: /^形/ })
    .click()
  const shapes = page.getByRole('menu', { name: 'フキダシの形' })
  await expect(shapes.getByRole('menuitemradio', { name: /普通/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await shapes.getByRole('menuitemradio', { name: /叫び/ }).click()
  await expect(shapes).toBeHidden()
  await expect(bubble).toHaveAttribute('data-shape', 'shout')
})
