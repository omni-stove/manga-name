import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_EPISODE, FIXTURE_PROJECT, importProject } from './app'

test('エピソード設定でタイトルを変えられ、キャンセルでは変わらない', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  const settings = page.getByRole('button', { name: m.web_episode_settings() })
  const dialog = page.getByRole('dialog', { name: m.web_episode_settings() })
  const title = dialog.getByRole('textbox', { name: m.episode_title() })
  const heading = page.getByText(FIXTURE_EPISODE, { exact: true })

  await settings.click()
  await title.fill('取り消す名前')
  await dialog.getByRole('button', { name: m.cancel() }).click()
  await expect(heading).toBeVisible()

  await settings.click()
  await expect(title).toHaveValue(FIXTURE_EPISODE)
  await title.fill('新しい名前')
  await dialog.getByRole('button', { name: m.save() }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('新しい名前', { exact: true })).toBeVisible()
})
