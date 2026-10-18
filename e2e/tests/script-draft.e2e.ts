import { expect, type Page, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, waitSaved } from './app'

const SCRIPT = ['結晶の森。E が奥へ歩いていく。', 'E「……ここか」', 'E、足元を見る。'].join('\n')

const pageLinks = (page: Page) => page.getByRole('link', { name: /\d+ ページ$/ })

/** エピソードのページ一覧から「脚本から下書き」を開き、脚本を入れて Fake のページ割り（2 ページ）を受け取る */
async function plan(page: Page) {
  await page.getByRole('button', { name: '脚本から下書き' }).click()
  const dialog = page.getByRole('dialog', { name: '脚本から下書き' })
  await dialog.getByLabel('脚本').fill(SCRIPT)
  await dialog.getByRole('button', { name: '週刊連載 19' }).click()
  await expect(dialog.getByLabel('ページ数')).toHaveValue('19')
  await expect(dialog.getByText('週刊少年誌の 1 話はおよそ 16〜20 ページ')).toBeVisible()
  await dialog.getByLabel('ページ数').fill('2')
  await dialog.getByLabel('トーンのヒント').fill('静か')
  await dialog.getByRole('button', { name: 'ページ割りを作る' }).click()
  await expect(dialog.locator('[data-plan-page]')).toHaveCount(2)
  return dialog
}

test('ページ割りで流れと登場キャラを確かめて直し、テンプレートのページで追加し、Undo で丸ごと戻す', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await expect(pageLinks(page)).toHaveCount(1)

  const dialog = await plan(page)
  const second = dialog.locator('[data-plan-page="2"]')
  await expect(second.getByLabel('流れ')).toHaveValue(/足元の何かに気づく/)
  await expect(second.getByRole('checkbox', { name: 'E' })).toBeChecked()
  await second.getByLabel('流れ').fill('E が足元の結晶に気づき、しゃがみ込む。')

  await dialog.getByRole('button', { name: '2 ページを追加' }).click()
  await expect(dialog).toBeHidden()
  await expect(pageLinks(page)).toHaveCount(3)
  // 人が直した流れがページのメモになり、ページ一覧のカードに出る
  await expect(page.getByText('結晶の森の奥へ E が歩いていく。')).toBeVisible()
  await expect(page.getByText('E が足元の結晶に気づき、しゃがみ込む。')).toBeVisible()
  await expect(page.locator('[data-page-cast]').nth(2)).toHaveText('登場: E')
  // ページ一覧のテンプレート（既定は 3 段）でコマを割る。フィクスチャの 1 ページ目もコマ 6
  await expect(page.getByText('コマ 6 / 生成')).toHaveCount(3)
  await waitSaved(page)

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(pageLinks(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(pageLinks(page)).toHaveCount(3)
})
