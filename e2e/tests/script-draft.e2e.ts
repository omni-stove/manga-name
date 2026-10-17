import { expect, type Page, test } from '@playwright/test'
import { createProject, FIXTURE_PROJECT, importProject, waitSaved } from './app'

const SCRIPT = ['結晶の森。E が奥へ歩いていく。', 'E「……ここか」', 'E、足元を見る。'].join('\n')

const pageLinks = (page: Page) => page.getByRole('link', { name: /\d+ ページ$/ })

/** エピソードのページ一覧から「脚本から下書き」を開き、脚本を入れて Fake のページ割り（2 ページ）を受け取る */
async function plan(page: Page) {
  await page.getByRole('button', { name: '脚本から下書き' }).click()
  const dialog = page.getByRole('dialog', { name: '脚本から下書き' })
  await dialog.getByLabel('脚本').fill(SCRIPT)
  await dialog.getByLabel('ページ数').fill('2')
  await dialog.getByLabel('トーンのヒント').fill('静か')
  await dialog.getByRole('button', { name: 'ページ割りを作る' }).click()
  await expect(dialog.locator('[data-plan-page]')).toHaveCount(2)
  return dialog
}

test('ページ割りで流れと登場キャラを確かめて直し、コマ割りまで作って追加し、Undo で丸ごと戻す', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await expect(pageLinks(page)).toHaveCount(1)

  const dialog = await plan(page)
  const second = dialog.locator('[data-plan-page="2"]')
  await expect(second.getByLabel('流れ')).toHaveValue(/足元の何かに気づく/)
  await expect(second.getByRole('checkbox', { name: 'E' })).toBeChecked()
  await second.getByLabel('流れ').fill('E が足元の結晶に気づき、しゃがみ込む。')

  await dialog.getByRole('button', { name: 'コマ割りを作る' }).click()
  await expect(dialog.locator('[data-proposal-page]')).toHaveCount(2)
  const proposal = dialog.locator('[data-proposal-page="2"]')
  await expect(proposal.getByLabel('2 ページ（コマ 4）')).toBeChecked()
  await expect(proposal.locator('[data-panel-id]')).toHaveCount(4)
  await expect(proposal.getByText('E が足元の結晶に気づき、しゃがみ込む。')).toBeVisible()

  await dialog.getByRole('button', { name: '2 ページを追加' }).click()
  await expect(dialog).toBeHidden()
  await expect(pageLinks(page)).toHaveCount(3)
  // 提案の仮 ID（tmp_）は振り直されている
  await expect(pageLinks(page).nth(1)).not.toHaveAttribute('href', /tmp_/)
  // 人が直した流れがページのメモになり、ページ一覧のカードに出る
  await expect(page.getByText('E が足元の結晶に気づき、しゃがみ込む。')).toBeVisible()
  await expect(page.locator('[data-page-cast]').nth(2)).toHaveText('登場: E')
  await waitSaved(page)

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(pageLinks(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(pageLinks(page)).toHaveCount(3)
})

test('コマ割りをせず、流れと登場キャラだけでページを追加する', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  const dialog = await plan(page)
  await dialog.getByRole('button', { name: '流れだけで 2 ページを追加' }).click()
  await expect(dialog).toBeHidden()
  await expect(pageLinks(page)).toHaveCount(3)
  await expect(page.getByText('結晶の森の奥へ E が歩いていく。')).toBeVisible()
  // ページ一覧のテンプレート（既定は 3 段）でコマを割る。フィクスチャの 1 ページ目もコマ 6
  await expect(page.getByText('コマ 6 / 生成')).toHaveCount(3)
})

test('スキーマを通らない提案はエラーを出し、追加させない', async ({ page }) => {
  // Fake の提案はフィクスチャのキャラクター E を指すので、キャラクターのいないプロジェクトでは通らない
  await createProject(page, '下書きの検証')
  const dialog = await plan(page)
  await dialog.getByRole('button', { name: 'コマ割りを作る' }).click()

  const proposal = dialog.locator('[data-proposal-page="1"]')
  await expect(proposal.getByRole('alert')).toContainText('スキーマを通らない')
  await expect(proposal.getByRole('alert')).toContainText('characterId')
  await expect(proposal.getByRole('checkbox')).toBeDisabled()
  await expect(dialog.getByRole('button', { name: '0 ページを追加' })).toBeDisabled()

  await dialog.getByRole('button', { name: '破棄' }).click()
  await expect(dialog).toBeHidden()
  await expect(pageLinks(page)).toHaveCount(0)
  // 履歴に残るのは 1 話目の追加だけで、それを戻せば Undo するものは無い
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  await undo.click()
  await expect(page.getByText('エピソードが見つかりません')).toBeVisible()
  await expect(undo).toBeDisabled()
})
