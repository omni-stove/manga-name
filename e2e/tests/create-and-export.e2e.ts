import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import {
  arts,
  clickInsidePanel,
  createProject,
  exportPng,
  inspector,
  openPage,
  panelInspector,
  pngSize,
  selectPanel,
  selectTool,
  waitSaved,
} from './app'

test('作成からコマ分割、フキダシ、生成、PNG 書き出しまで行い、リロードで復元される', async ({
  page,
}) => {
  await createProject(page, 'e2e シナリオ 1')
  await page.getByRole('button', { name: m.web_episode_add_page() }).click()
  await openPage(page, 1)
  await expect(inspector(page).getByText(m.web_editor_elements({ count: 6 }))).toBeVisible()

  await selectTool(page, m.panel())
  await selectPanel(page, 1)
  await page.getByRole('button', { name: m.editor_canvas_panel_split_vertical_aria() }).click()
  await expect(inspector(page).getByText(m.web_editor_elements({ count: 7 }))).toBeVisible()

  await selectTool(page, m.bubble())
  await clickInsidePanel(page, 0)
  const bubble = page.locator('[data-inspector="bubble"]')
  await expect(bubble).toBeVisible()
  await bubble.getByLabel(m.bubble_text()).fill('こんにちは')
  await bubble.getByLabel(m.bubble_text()).blur()
  const line = inspector(page).getByRole('button', {
    name: m.web_editor_outline_bubble({ order: 1, text: 'こんにちは' }),
  })
  await expect(line).toBeVisible()

  await selectTool(page, m.web_editor_tool_select())
  await selectPanel(page, 1)
  await panelInspector(page).getByRole('button', { name: m.generate(), exact: true }).click()
  await expect(arts(page)).toHaveCount(1)
  await expect(arts(page).first()).toHaveAttribute('data-current', 'true')
  await expect(page.locator('[data-panel-id] image')).toHaveCount(1)

  // 182 x 257mm を 300dpi で描く
  expect(pngSize(await exportPng(page))).toEqual({ width: 2150, height: 3036 })

  await waitSaved(page)
  await page.reload()
  await expect(inspector(page).getByText(m.web_editor_elements({ count: 7 }))).toBeVisible()
  await expect(line).toBeVisible()
  await expect(page.locator('[data-panel-id] image')).toHaveCount(1)
  await selectPanel(page, 1)
  await expect(arts(page)).toHaveCount(1)
  await expect(arts(page).first()).toHaveAttribute('data-current', 'true')
})
