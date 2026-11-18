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

test('インスペクタの縁をドラッグすると幅が変わり、幅は再読み込みしても残る', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  const sidebar = page.getByRole('complementary', { name: m.web_editor_inspector() })
  const handle = page.getByRole('separator', {
    name: m.ui_sidebar_resize({ title: m.web_editor_inspector() }),
  })
  const before = (await sidebar.boundingBox())?.width ?? 0
  const box = await handle.boundingBox()
  if (!box) throw new Error('つまみが見えない')

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 80, y, { steps: 4 })
  await page.mouse.up()
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeCloseTo(before + 80, 0)

  await page.reload()
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeCloseTo(before + 80, 0)

  await handle.dblclick()
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeCloseTo(before, 0)
})
