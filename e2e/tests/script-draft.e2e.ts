import { expect, type Page, test } from '@playwright/test'
import { createProject, FIXTURE_PROJECT, importProject, waitSaved } from './app'

const SCRIPT = ['結晶の森。E が奥へ歩いていく。', 'E「……ここか」', 'E、足元を見る。'].join('\n')

const pageLinks = (page: Page) => page.getByRole('link', { name: /\d+ ページ$/ })

/** ページ一覧から「脚本から下書き」を開き、脚本を入れて Fake の提案を受け取る */
async function propose(page: Page) {
  await page.getByRole('button', { name: '脚本から下書き' }).click()
  const dialog = page.getByRole('dialog', { name: '脚本から下書き' })
  await dialog.getByLabel('脚本').fill(SCRIPT)
  await dialog.getByLabel('ページ数の目安').fill('1')
  await dialog.getByLabel('トーンのヒント').fill('静か')
  await dialog.getByRole('button', { name: '提案を作る' }).click()
  await expect(dialog.locator('[data-proposal-page]')).toHaveCount(1)
  return dialog
}

test('脚本から下書きを作ってページを追加し、Undo で丸ごと戻す', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await expect(pageLinks(page)).toHaveCount(1)

  const dialog = await propose(page)
  await expect(dialog.getByText('右綴じなので各段は右から左に読む')).toBeVisible()
  const proposal = dialog.locator('[data-proposal-page="1"]')
  await expect(proposal.locator('[data-panel-id]')).toHaveCount(4)
  await expect(proposal.getByLabel('1 ページ（コマ 4）')).toBeChecked()

  await dialog.getByRole('button', { name: '1 ページを追加' }).click()
  await expect(dialog).toBeHidden()
  await expect(pageLinks(page)).toHaveCount(2)
  // 提案の仮 ID（tmp_）は振り直されている
  await expect(pageLinks(page).nth(1)).not.toHaveAttribute('href', /tmp_/)
  await expect(page.getByText('コマ 4 / 生成')).toBeVisible()
  await waitSaved(page)

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(pageLinks(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(pageLinks(page)).toHaveCount(2)
})

test('スキーマを通らない提案はエラーを出し、追加させない', async ({ page }) => {
  // Fake の提案はフィクスチャのキャラクター E を指すので、キャラクターのいないプロジェクトでは通らない
  await createProject(page, '下書きの検証')
  const dialog = await propose(page)

  const proposal = dialog.locator('[data-proposal-page="1"]')
  await expect(proposal.getByRole('alert')).toContainText('スキーマを通らない')
  await expect(proposal.getByRole('alert')).toContainText('characterId')
  await expect(proposal.getByRole('checkbox')).toBeDisabled()
  await expect(dialog.getByRole('button', { name: '0 ページを追加' })).toBeDisabled()

  await dialog.getByRole('button', { name: '破棄' }).click()
  await expect(dialog).toBeHidden()
  await expect(pageLinks(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})
