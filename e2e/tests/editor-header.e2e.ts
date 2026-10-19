import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage } from './app'

test('エディタのヘッダーで、キーでツールとペンを選び、前後のページへ移れ、ページを足せる', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await page.getByRole('button', { name: m.web_episode_add_page() }).click()
  await openPage(page, 1)

  const tools = page.getByRole('group', { name: m.web_editor_tools() })
  await page.keyboard.press('b')
  await expect(tools.getByRole('radio', { name: m.bubble() })).toBeChecked()
  await page.keyboard.press('d')
  await expect(tools.getByRole('radio', { name: m.page_scribbles() })).toBeChecked()
  await page.keyboard.press('3')
  await expect(
    page
      .getByRole('group', { name: m.web_editor_pen() })
      .getByRole('radio', { name: m.stroke_color_blue() }),
  ).toBeChecked()
  // ラジオにフォーカスがあってもキーが効く
  await tools.getByText(m.web_editor_tool_select(), { exact: true }).click()
  await page.keyboard.press('p')
  await expect(tools.getByRole('radio', { name: m.panel() })).toBeChecked()

  const current = page.getByRole('combobox', { name: m.page() }).locator('option:checked')
  const prev = page.getByRole('button', { name: m.web_editor_prev_page() })
  const next = page.getByRole('button', { name: m.web_editor_next_page() })
  await expect(current).toHaveText(m.web_editor_page_option({ index: 1, total: 2 }))
  await expect(prev).toBeDisabled()
  await page.keyboard.press(']')
  await expect(current).toHaveText(m.web_editor_page_option({ index: 2, total: 2 }))
  await expect(next).toBeDisabled()
  await prev.click()
  await expect(current).toHaveText(m.web_editor_page_option({ index: 1, total: 2 }))
  await page
    .getByRole('combobox', { name: m.page() })
    .selectOption({ label: m.web_editor_page_option({ index: 2, total: 2 }) })
  await expect(current).toHaveText(m.web_editor_page_option({ index: 2, total: 2 }))
  await page.keyboard.press('[')
  await expect(current).toHaveText(m.web_editor_page_option({ index: 1, total: 2 }))

  await page.getByRole('button', { name: m.web_episode_add_page() }).click()
  await expect(current).toHaveText(m.web_editor_page_option({ index: 3, total: 3 }))
})
