import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  comparePng,
  exportPng,
  FIXTURE_PROJECT,
  importProject,
  openPage,
  pngSize,
  RENDER_SNAPSHOT_ARTS,
} from './app'

test('フィクスチャを読み込んでページを一括生成し、書き出した PNG がレンダラのスナップショットと一致する', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)

  const generateAll = page.getByRole('button', { name: 'このページを全部生成' })
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
