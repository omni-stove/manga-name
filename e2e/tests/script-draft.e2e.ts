import { expect, type Page, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject } from './app'

const SCRIPT = ['結晶の森。E が奥へ歩いていく。', 'E「……ここか」', 'E、足元を見る。'].join('\n')

const pageLinks = (page: Page) => page.getByRole('link', { name: /\d+ ページ$/ })

/** エピソードのページ一覧から「脚本から下書き」のページへ移り、脚本を入れて Fake のページ割り（2 ページ）を受け取る */
async function plan(page: Page) {
  await page.getByRole('button', { name: '脚本から下書き' }).click()
  await expect(page.getByRole('heading', { name: '脚本から下書き' })).toBeVisible()
  await page.getByLabel('脚本').fill(SCRIPT)
  await page.getByRole('button', { name: '週刊連載 19' }).click()
  await expect(page.getByLabel('ページ数')).toHaveValue('19')
  await expect(page.getByText('週刊少年誌の 1 話はおよそ 16〜20 ページ')).toBeVisible()
  await page.getByLabel('ページ数').fill('2')
  await page.getByLabel('トーンのヒント').fill('静か')
  await page.getByRole('button', { name: 'ページ割りを作る' }).click()
  await expect(page.locator('[data-plan-page]')).toHaveCount(2)
}

test('ページ割りで流れと登場キャラとセリフを確かめて直し、セリフをフキダシにしたページで追加する', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await expect(pageLinks(page)).toHaveCount(1)

  await plan(page)
  const first = page.locator('[data-plan-page="1"]')
  const second = page.locator('[data-plan-page="2"]')
  await expect(first.getByLabel('セリフ', { exact: true })).toHaveValue('……ここか')
  await expect(second.getByLabel('流れ')).toHaveValue(/何かに気づく/)
  await expect(second.getByLabel('このページの脚本')).toHaveValue(/光るものがあった/)
  await expect(second.getByRole('checkbox', { name: 'E' })).toBeChecked()
  await expect(page.locator('[data-missing-lines]')).toHaveCount(0)
  await second.getByLabel('流れ').fill('E が足元の結晶に気づき、しゃがみ込む。')

  // 脚本のセリフを消すと、どのページにも入っていないセリフとして知らせる
  await first.getByRole('button', { name: 'セリフを削除' }).click()
  await expect(page.locator('[data-missing-lines]')).toContainText('「……ここか」')
  await first.getByRole('button', { name: 'セリフを足す' }).click()
  await first.getByLabel('セリフ', { exact: true }).fill('……ここか')
  await expect(page.locator('[data-missing-lines]')).toHaveCount(0)

  await page.getByRole('button', { name: '2 ページを追加' }).click()
  await expect(pageLinks(page)).toHaveCount(3)
  // 人が直した流れがページのメモになり、ページ一覧のカードに出る
  await expect(page.getByText('結晶の森。E が奥へ歩いていく。')).toBeVisible()
  await expect(page.getByText('E が足元の結晶に気づき、しゃがみ込む。')).toBeVisible()
  await expect(page.locator('[data-page-cast]').nth(2)).toHaveText('登場: E')
  // 下書きのテンプレート（既定は 3 段）でコマを割る。フィクスチャの 1 ページ目もコマ 6
  await expect(page.getByText('コマ 6 / 生成')).toHaveCount(3)

  // ページ割りの脚本が、ページの編集画面の左の欄に出る
  await pageLinks(page).nth(2).click()
  await expect(page.getByLabel('このページの脚本')).toHaveValue(/光るものがあった/)
})
