import { fileURLToPath } from 'node:url'
import { m } from '@manga/i18n'
import { expect, type Page, test } from '@playwright/test'
import {
  FIXTURE_EPISODE,
  FIXTURE_PROJECT,
  importProject,
  inspector,
  openEpisode,
  openPage,
  panelInspector,
  selectPanel,
} from './app'

const REFERENCE = fileURLToPath(new URL('../../fixtures/art/pn_1.png', import.meta.url))

/** キャラクター一覧から追加のページを開く */
async function openNewCharacter(page: Page): Promise<void> {
  await page.getByRole('link', { name: m.character() }).click()
  await page.getByRole('button', { name: m.web_characters_add() }).click()
  await expect(page.getByRole('heading', { name: m.web_characters_add() })).toBeVisible()
}

test('参照画像付きで追加したキャラを、台詞の無いコマの登場キャラに足す', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openNewCharacter(page)
  await page.getByLabel(m.character_name()).fill('通行人')
  await page.getByLabel(m.character_short_name()).fill('通')
  await page.getByLabel(m.character_reference()).setInputFiles(REFERENCE)
  await page.getByRole('button', { name: m.add(), exact: true }).click()

  const card = page.locator('[data-inspector="character"]').filter({ hasText: '通行人' })
  await expect(
    card.getByRole('img', { name: m.inspector_character_reference_alt({ name: '通行人' }) }),
  ).toBeVisible()

  await page.getByRole('link', { name: m.episode(), exact: true }).click()
  await openEpisode(page, FIXTURE_EPISODE)
  await openPage(page, 1)
  await selectPanel(page, 2)
  await panelInspector(page)
    .getByLabel(m.inspector_panel_cast_add())
    .selectOption({ label: '通行人' })
  const added = panelInspector(page).locator('li[data-cast-id]').filter({ hasText: '通行人' })
  await expect(added).toBeVisible()

  const pageCast = inspector(page).locator('[data-section="page-cast"]')
  await pageCast.locator('summary').click()
  await expect(pageCast.locator('li').filter({ hasText: '通行人' })).toContainText(
    m.web_page_cast_panel_count({ count: 1 }),
  )

  await added
    .getByRole('button', { name: m.inspector_panel_cast_remove({ name: '通行人' }) })
    .click()
  await expect(added).toHaveCount(0)
})

test('参照画像を選ばずに追加したキャラは、外見から生成した参照画像で始まる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openNewCharacter(page)
  await page.getByLabel(m.character_name()).fill('店主')
  await page.getByLabel(m.character_short_name()).fill('店')
  await page.getByLabel(m.web_character_field_appearance()).fill('白髪の老人。前掛け。')
  await page.getByRole('button', { name: m.add(), exact: true }).click()

  const card = page.locator('[data-inspector="character"]').filter({ hasText: '店主' })
  await expect(
    card.getByRole('img', { name: m.inspector_character_reference_alt({ name: '店主' }) }),
  ).toBeVisible()
  await expect(
    card.getByRole('img', { name: m.inspector_character_default_reference() }),
  ).toHaveCount(0)
})
