import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage, panelInspector } from './app'

test('キャンバスの何も無いところを右クリックしてメニューから操作できる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await page.getByRole('button', { name: m.web_episode_add_page() }).click()
  await openPage(page, 1)

  const canvas = page.getByRole('application', { name: m.web_editor_canvas() })
  const menu = page.getByRole('menu', { name: m.web_editor_page_menu() })
  // 左上の隅は作業台
  await canvas.click({ button: 'right', position: { x: 4, y: 4 } })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: m.web_editor_prev_page() })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  await canvas.click({ button: 'right', position: { x: 4, y: 4 } })
  await menu.getByRole('menuitem', { name: m.web_editor_next_page() }).click()
  await expect(menu).toBeHidden()
  await expect(page.getByRole('combobox', { name: m.page() }).locator('option:checked')).toHaveText(
    m.web_editor_page_option({ index: 2, total: 2 }),
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
  const menu = page.getByRole('menu', { name: m.web_editor_menu_panel() })
  await expect(menu).toBeVisible()
  await expect(panelInspector(page)).toBeVisible()
  await menu.getByRole('menuitem', { name: m.remove() }).click()
  await expect(panels).toHaveCount(count - 1)
})

test('フキダシを右クリックして形を変えられる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  // 焦点とベクトルはフキダシより先に拾うので、隠しておく
  await page
    .getByRole('group', { name: m.web_editor_layers() })
    .getByLabel(m.web_editor_layer_hints())
    .uncheck()

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
    .getByRole('menu', { name: m.web_editor_menu_bubble() })
    .getByRole('menuitem', {
      name: m.web_canvas_menu_bubble_shape({ shape: m.bubble_shape_normal() }),
    })
    .click()
  const shapes = page.getByRole('menu', { name: m.web_editor_menu_bubble_shapes() })
  await expect(
    shapes.getByRole('menuitemradio', { name: m.bubble_shape_normal() }),
  ).toHaveAttribute('aria-checked', 'true')
  await shapes.getByRole('menuitemradio', { name: m.bubble_shape_shout() }).click()
  await expect(shapes).toBeHidden()
  await expect(bubble).toHaveAttribute('data-shape', 'shout')
})

test('選んだコマは、右クリックしなくてもインスペクタからロックと削除ができる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)

  const panels = page.locator('[data-panel-id]')
  const count = await panels.count()
  const box = await panels.first().boundingBox()
  if (!box) throw new Error('panel is not rendered')
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3)
  await expect(panelInspector(page)).toBeVisible()

  const actions = page.locator('[data-section="element-actions"]')
  const locks = page.locator('[data-locked]')
  const lockCount = await locks.count()
  await actions.getByRole('checkbox', { name: m.web_canvas_menu_lock() }).check()
  await expect(locks).toHaveCount(lockCount + 1)
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3, { button: 'right' })
  await expect(
    page.getByRole('menu', { name: m.web_editor_menu_panel() }).getByRole('menuitemradio', {
      name: m.web_canvas_menu_lock(),
    }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')

  await actions.getByRole('button', { name: m.remove() }).click()
  await expect(panels).toHaveCount(count - 1)
})

test.describe('タッチ', () => {
  test.use({ hasTouch: true })

  test('コマを長押しすると、右クリックと同じメニューが開く', async ({ page }) => {
    await importProject(page, FIXTURE_PROJECT)
    await openPage(page, 1)

    const box = await page.locator('[data-panel-id]').first().boundingBox()
    if (!box) throw new Error('panel is not rendered')
    const at = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 }
    // Playwright の touchscreen は tap しかできないので、押して待って離すのは CDP で送る
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
    const menu = page.getByRole('menu', { name: m.web_editor_menu_panel() })
    await expect(menu).toBeVisible()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(menu).toBeVisible()
    await expect(panelInspector(page)).toBeVisible()
  })
})
