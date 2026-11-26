import { m } from '@manga/i18n'
import { expect, type Page, test } from '@playwright/test'
import {
  FIXTURE_EPISODE,
  FIXTURE_PROJECT,
  FIXTURE_PROJECT_TITLE,
  importProject,
  openPage,
} from './app'

const breadcrumb = (page: Page) => page.getByRole('navigation', { name: m.web_breadcrumb() })

/** パンくずの項目が items の順に並び、最後の項目だけリンクでないことを確かめる */
async function expectTrail(page: Page, items: string[]) {
  await expect(breadcrumb(page).getByRole('listitem')).toHaveText(
    items.map((item, i) => (i === 0 ? item : `›${item}`)),
  )
  await expect(breadcrumb(page).getByRole('link')).toHaveCount(items.length - 1)
}

test('プロジェクト配下の画面に作品名から今の画面までのパンくずが出て、途中の項目からその画面に移れる', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await expectTrail(page, [FIXTURE_PROJECT_TITLE, FIXTURE_EPISODE])

  await page.getByRole('button', { name: m.web_draft_title() }).click()
  await expectTrail(page, [FIXTURE_PROJECT_TITLE, FIXTURE_EPISODE, m.web_draft_title()])
  await breadcrumb(page).getByRole('link', { name: FIXTURE_EPISODE }).click()
  await expect(page.getByRole('button', { name: m.web_episode_add_page() })).toBeVisible()

  await openPage(page, 1)
  await expectTrail(page, [
    FIXTURE_PROJECT_TITLE,
    FIXTURE_EPISODE,
    m.web_episode_page_number({ number: 1 }),
  ])
  await breadcrumb(page).getByRole('link', { name: FIXTURE_PROJECT_TITLE, exact: true }).click()
  await expectTrail(page, [FIXTURE_PROJECT_TITLE])
  await expect(page.getByRole('button', { name: m.web_episodes_add() })).toBeVisible()

  await page.getByRole('link', { name: m.character(), exact: true }).click()
  await expectTrail(page, [FIXTURE_PROJECT_TITLE, m.web_characters_title()])
  await page.getByRole('button', { name: m.web_characters_add() }).click()
  await expectTrail(page, [
    FIXTURE_PROJECT_TITLE,
    m.web_characters_title(),
    m.web_characters_add(),
  ])
  await breadcrumb(page).getByRole('link', { name: m.web_characters_title() }).click()
  await expectTrail(page, [FIXTURE_PROJECT_TITLE, m.web_characters_title()])
  await expect(page.getByRole('button', { name: m.web_characters_add() })).toBeVisible()
})

test('エピソードの題を設定で変えると、パンくずの表記もすぐ変わる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await page.getByRole('button', { name: m.web_episode_settings() }).click()
  const dialog = page.getByRole('dialog', { name: m.web_episode_settings() })
  await dialog.getByLabel(m.episode_title()).fill('改題した話')
  await dialog.getByRole('button', { name: m.save() }).click()
  await expect(dialog).toBeHidden()
  await expectTrail(page, [FIXTURE_PROJECT_TITLE, '改題した話'])
})
