import { expect, test } from '@playwright/test'
import { createProject, FIXTURE_EPISODE, FIXTURE_PROJECT, importProject } from './app'

test('エピソードは一覧と話の画面から、確認ダイアログを経て削除できる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await page.getByRole('button', { name: 'エピソードを削除' }).click()
  const dialog = page.getByRole('dialog', { name: 'エピソードを削除' })
  await expect(dialog).toContainText(`「${FIXTURE_EPISODE}」とその 1 ページ`)
  await dialog.getByRole('button', { name: 'キャンセル' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'ページを追加' })).toBeVisible()

  await page.getByRole('button', { name: 'エピソードを削除' }).click()
  await dialog.getByRole('button', { name: '削除' }).click()
  await expect(page.getByText('エピソードがありません。')).toBeVisible()

  await importProject(page, FIXTURE_PROJECT)
  await page.getByRole('link', { name: 'エピソード一覧', exact: true }).click()
  const card = page.getByRole('listitem').filter({ hasText: FIXTURE_EPISODE })
  await card.getByRole('button', { name: '削除' }).click()
  await dialog.getByRole('button', { name: '削除' }).click()
  await expect(page.getByText('エピソードがありません。')).toBeVisible()
})

test('プロジェクトは一覧から、確認ダイアログを経て削除できる', async ({ page }) => {
  await createProject(page, '消す作品')
  await page.goto('/')
  const card = page.getByRole('listitem').filter({ hasText: '消す作品' })
  await card.getByRole('button', { name: '削除' }).click()
  const dialog = page.getByRole('dialog', { name: 'プロジェクトを削除' })
  await expect(dialog).toContainText('元に戻せません')
  await dialog.getByRole('button', { name: '削除' }).click()
  await expect(card).toBeHidden()
})
