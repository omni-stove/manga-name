import { readFile } from 'node:fs/promises'
import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import {
  arts,
  comparePng,
  exportPng,
  FIXTURE_PROJECT,
  importProject,
  openPage,
  panelInspector,
  pngSize,
  RENDER_SNAPSHOT_ARTS,
  selectPanel,
} from './app'

test('フィクスチャを読み込んでページを一括生成し、書き出した PNG がレンダラのスナップショットと一致する', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)

  const generateAll = page.getByRole('button', { name: m.inspector_page_generate_all() })
  await generateAll.click()
  await expect(page.locator('[data-panel-id] image')).toHaveCount(6)
  await expect(generateAll).toBeEnabled()

  const png = await exportPng(page, { panelNumbers: true })
  const snapshot = await readFile(RENDER_SNAPSHOT_ARTS)
  const exported = pngSize(png)
  const expected = pngSize(snapshot)
  expect(exported.width / exported.height).toBeCloseTo(expected.width / expected.height, 2)

  const diff = await comparePng(page, png, snapshot)
  // 縮めた後に残るのは線と文字の縁の丸めだけ。コマの絵やフキダシが欠ければ平均が桁で変わる
  expect(diff.mean).toBeLessThan(2)
  expect(diff.max).toBeLessThan(48)
})

test('ページを一括生成した後、気に入らない 1 コマだけをコマ単位で作り直せる', async ({ page }) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)

  const generateAll = page.getByRole('button', { name: m.inspector_page_generate_all() })
  await generateAll.click()
  await expect(page.locator('[data-panel-id] image')).toHaveCount(6)
  await expect(generateAll).toBeEnabled()

  await selectPanel(page, 1)
  await expect(arts(page)).toHaveCount(1)
  const inspector = panelInspector(page)
  await inspector.getByLabel(m.inspector_panel_instruction()).fill('もっと引きで')
  await inspector.getByRole('button', { name: m.inspector_panel_regenerate() }).click()
  await expect(arts(page)).toHaveCount(2)
  await expect(arts(page).nth(0)).toContainText('もっと引きで')
  await expect(arts(page).nth(0)).toHaveAttribute('data-current', 'true')
  await expect(page.locator('[data-panel-id] image')).toHaveCount(6)
})
