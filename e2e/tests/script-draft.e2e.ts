import { m } from '@manga/i18n'
import { expect, type Page, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject } from './app'

const SCRIPT = ['結晶の森。E が奥へ歩いていく。', 'E「……ここか」', 'E、足元を見る。'].join('\n')

const pageLinks = (page: Page) =>
  page.getByRole('link', {
    name: new RegExp(`${m.web_episode_page_number({ number: '\\d+' })}$`),
  })

/** エピソードのページ一覧から「脚本から下書き」のページへ移り、脚本を入れて Fake のページ割り（2 ページ）を受け取る */
async function plan(page: Page) {
  await page.getByRole('button', { name: m.web_draft_title() }).click()
  await expect(page.getByRole('heading', { name: m.web_draft_title() })).toBeVisible()
  await page.getByLabel(m.web_draft_script()).fill(SCRIPT)
  await page.getByRole('button', { name: `${m.web_page_count_guide_weekly()} 19` }).click()
  await expect(page.getByLabel(m.web_draft_page_count())).toHaveValue('19')
  await expect(page.getByText(m.web_page_count_guide_weekly_hint())).toBeVisible()
  await page.getByLabel(m.web_draft_page_count()).fill('2')
  await page.getByLabel(m.web_draft_tone()).fill('静か')
  await page.getByRole('button', { name: m.web_draft_plan() }).click()
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
  await expect(first.getByLabel(m.bubble_text(), { exact: true })).toHaveValue('……ここか')
  await expect(second.getByLabel(m.web_draft_flow())).toHaveValue(/何かに気づく/)
  await expect(second.getByLabel(m.web_draft_page_script())).toHaveValue(/光るものがあった/)
  await expect(second.getByRole('checkbox', { name: 'E' })).toBeChecked()
  await expect(page.locator('[data-missing-lines]')).toHaveCount(0)
  await second.getByLabel(m.web_draft_flow()).fill('E が足元の結晶に気づき、しゃがみ込む。')

  // 脚本のセリフを消すと、どのページにも入っていないセリフとして知らせる
  await first.getByRole('button', { name: m.web_draft_remove_line() }).click()
  await expect(page.locator('[data-missing-lines]')).toContainText('「……ここか」')
  await first.getByRole('button', { name: m.web_draft_add_line() }).click()
  await first.getByLabel(m.bubble_text(), { exact: true }).fill('……ここか')
  await expect(page.locator('[data-missing-lines]')).toHaveCount(0)

  await page.getByRole('button', { name: m.web_draft_add_pages({ count: 2 }) }).click()
  await expect(pageLinks(page)).toHaveCount(3)
  // 人が直した流れがページのメモになり、ページ一覧のカードに出る
  await expect(page.getByText('結晶の森。E が奥へ歩いていく。')).toBeVisible()
  await expect(page.getByText('E が足元の結晶に気づき、しゃがみ込む。')).toBeVisible()
  await expect(page.locator('[data-page-cast]').nth(2)).toHaveText(
    m.web_episode_page_cast({ cast: 'E' }),
  )
  // 下書きのテンプレート（既定は 3 段）でコマを割る。フィクスチャの 1 ページ目もコマ 6
  await expect(page.getByText(m.web_episode_page_summary({ panels: 6 }))).toHaveCount(3)

  // ページ割りの脚本が、ページの編集画面の左の欄に出る
  await pageLinks(page).nth(2).click()
  await expect(page.getByLabel(m.inspector_page_script())).toHaveValue(/光るものがあった/)
})
