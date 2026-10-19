import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { createProject, FIXTURE_EPISODE, FIXTURE_PROJECT, importProject } from './app'

test('エピソードは一覧と話の画面から、確認ダイアログを経て削除できる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await page.getByRole('button', { name: m.web_episode_remove() }).click()
  const dialog = page.getByRole('dialog', { name: m.web_episode_remove() })
  await expect(dialog).toContainText(
    m.web_episodes_remove_message({ title: FIXTURE_EPISODE, count: 1 }),
  )
  await dialog.getByRole('button', { name: m.cancel() }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: m.web_episode_add_page() })).toBeVisible()

  await page.getByRole('button', { name: m.web_episode_remove() }).click()
  await dialog.getByRole('button', { name: m.remove() }).click()
  await expect(page.getByText(m.web_episodes_empty())).toBeVisible()

  await importProject(page, FIXTURE_PROJECT)
  await page.getByRole('link', { name: m.web_episode_list(), exact: true }).click()
  const card = page.getByRole('listitem').filter({ hasText: FIXTURE_EPISODE })
  await card.getByRole('button', { name: m.remove() }).click()
  await dialog.getByRole('button', { name: m.remove() }).click()
  await expect(page.getByText(m.web_episodes_empty())).toBeVisible()
})

test('プロジェクトは一覧から、確認ダイアログを経て削除できる', async ({ page }) => {
  await createProject(page, '消す作品')
  await page.goto('/')
  const card = page.getByRole('listitem').filter({ hasText: '消す作品' })
  await card.getByRole('button', { name: m.remove() }).click()
  const dialog = page.getByRole('dialog', { name: m.web_projects_remove_title() })
  await expect(dialog).toContainText(m.web_projects_remove_message({ title: '消す作品' }))
  await dialog.getByRole('button', { name: m.remove() }).click()
  await expect(card).toBeHidden()
})
