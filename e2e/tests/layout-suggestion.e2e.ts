import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage } from './app'

test('ページの脚本からコマ割りの案を出し、確かめて今のコマを置き換え、Undo で戻す', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  const elements = page.getByText(new RegExp(`^${m.web_editor_elements({ count: '\\d+' })}$`))
  await expect(elements).toHaveText(m.web_editor_elements({ count: 6 }))

  const suggest = page.getByRole('button', { name: m.web_layout_suggest() })
  await expect(suggest).toBeDisabled()
  await page
    .getByLabel(m.inspector_page_script())
    .fill('結晶の森。E が奥へ歩いていく。\nE「……ここか」')
  await suggest.click()

  const options = page.locator('[data-layout-option]')
  await expect(options).toHaveCount(2)
  await expect(options.first()).toContainText(m.web_layout_suggest_option({ n: 1, panels: 3 }))

  // フィクスチャのページは絵とフキダシがあるので、置き換える前に確かめる
  await options.first().getByRole('button', { name: m.web_layout_suggest_apply() }).click()
  const dialog = page.getByRole('dialog', { name: m.web_layout_suggest_confirm_title() })
  await dialog.getByRole('button', { name: m.web_layout_suggest_apply() }).click()
  await expect(elements).toHaveText(m.web_editor_elements({ count: 3 }))
  await expect(page.getByLabel(m.inspector_page_script())).toHaveValue(/……ここか/)

  await page.getByRole('button', { name: m.web_history_undo(), exact: true }).click()
  await expect(elements).toHaveText(m.web_editor_elements({ count: 6 }))
})
