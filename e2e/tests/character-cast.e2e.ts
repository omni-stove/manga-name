import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
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

const REFERENCE = fileURLToPath(new URL('../../docs/fixtures/art/pn_1.png', import.meta.url))

test('キャラクター一覧で参照画像を付けたキャラを、台詞の無いコマの登場キャラに足す', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await page.getByRole('link', { name: 'キャラクター' }).click()
  await page.getByLabel('名前').last().fill('通行人')
  await page.getByLabel('略称').last().fill('通')
  await page.getByRole('button', { name: '追加' }).click()

  const card = page.locator('[data-inspector="character"]').filter({ hasText: '通行人' })
  await card.locator('..').locator('input[type="file"]').setInputFiles(REFERENCE)
  await expect(card.getByRole('img', { name: '通行人 の参照画像' })).toBeVisible()

  await page.getByRole('link', { name: 'エピソード', exact: true }).click()
  await openEpisode(page, FIXTURE_EPISODE)
  await openPage(page, 1)
  await selectPanel(page, 2)
  await panelInspector(page).getByLabel('登場キャラを追加').selectOption({ label: '通行人' })
  const added = panelInspector(page).locator('li[data-cast-id]').filter({ hasText: '通行人' })
  await expect(added).toBeVisible()

  const pageCast = inspector(page).locator('[data-section="page-cast"]')
  await pageCast.locator('summary').click()
  await expect(pageCast.locator('li').filter({ hasText: '通行人' })).toContainText('1 コマ')

  await added.getByRole('button', { name: '通行人 を登場キャラから外す' }).click()
  await expect(added).toHaveCount(0)
})
