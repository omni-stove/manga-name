import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage } from './app'

test('ページの脚本からネームを書き起こして直し、そのネームでコマ割りの案を出して今のコマを置き換え、Undo で戻す', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  const elements = page.getByText(new RegExp(`^${m.web_editor_elements({ count: '\\d+' })}$`))
  await expect(elements).toHaveText(m.web_editor_elements({ count: 6 }))

  const transcribe = page.getByRole('button', { name: m.web_name_transcribe() })
  await expect(transcribe).toBeDisabled()
  await page
    .getByLabel(m.inspector_page_script())
    .fill('結晶の森。E が奥へ歩いていく。\nE「……ここか」')
  await transcribe.click()

  const panels = page.locator('[data-name-panel]')
  await expect(panels).toHaveCount(3)
  const suggest = page.getByRole('button', { name: m.web_layout_suggest() })

  // 指示メモの無いコマを足すと提案できず、消せば戻る
  await page.getByRole('button', { name: m.web_name_add_panel() }).click()
  await expect(suggest).toBeDisabled()
  await panels.nth(3).getByRole('button', { name: m.web_name_remove_panel() }).click()
  await panels.first().getByLabel(m.panel_note()).fill('結晶の森の全景。E の背中。')
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

  // 直したネームはこのブラウザに残り、ページを開き直しても出る
  await page.reload()
  await expect(panels.first().getByLabel(m.panel_note())).toHaveValue('結晶の森の全景。E の背中。')
})

test('ページの脚本から、ネームを直さずにそのままコマ割りの案まで出す', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  await page
    .getByLabel(m.inspector_page_script())
    .fill('結晶の森。E が奥へ歩いていく。\nE「……ここか」')
  await page.getByRole('button', { name: m.web_name_transcribe_and_suggest() }).click()

  await expect(page.locator('[data-name-panel]')).toHaveCount(3)
  await expect(page.locator('[data-layout-option]')).toHaveCount(2)
})

test('脚本が無くてもネームを自分で書き、そのネームでコマ割りの案を出す', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  await expect(
    page.getByRole('button', { name: m.web_name_transcribe_and_suggest() }),
  ).toBeDisabled()
  await page.getByRole('button', { name: m.web_name_write() }).click()

  const panels = page.locator('[data-name-panel]')
  await expect(panels).toHaveCount(1)
  const suggest = page.getByRole('button', { name: m.web_layout_suggest() })
  await expect(suggest).toBeDisabled()
  await panels.first().getByLabel(m.panel_note()).fill('結晶の森の全景。E の背中。')
  await suggest.click()
  await expect(page.locator('[data-layout-option]')).toHaveCount(2)
})
