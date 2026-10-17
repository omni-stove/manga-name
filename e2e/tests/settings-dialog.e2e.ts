import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage } from './app'

test('エディタからナビの設定を開いて閉じると、同じページに戻る', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  const editor = page.url()
  const nav = page.getByRole('navigation', { name: 'ナビゲーション' })

  await nav.getByRole('link', { name: '設定', exact: true }).click()
  const project = page.getByRole('dialog', { name: 'プロジェクト設定' })
  await expect(project.getByLabel('dpi')).toBeVisible()
  await project.getByRole('button', { name: '閉じる' }).click()
  await expect(project).toBeHidden()
  await expect(page).toHaveURL(editor)

  await nav.getByRole('link', { name: 'アプリ設定' }).click()
  const app = page.getByRole('dialog', { name: 'アプリ設定' })
  await expect(app.getByRole('group', { name: 'テーマ' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(app).toBeHidden()
  await expect(page).toHaveURL(editor)
})
