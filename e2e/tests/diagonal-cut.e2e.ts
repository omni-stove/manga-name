import { expect, test } from '@playwright/test'
import {
  clickInsidePanel,
  FIXTURE_PROJECT,
  importProject,
  openPage,
  selectTool,
  waitSaved,
} from './app'

test('コマを斜めの線で割ると 2 つの台形になり、頂点を動かせて、読み込み直しても形が残る', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  await selectTool(page, 'コマ')
  await clickInsidePanel(page, 0)

  const pn1 = await page.locator('[data-panel-id="pn_1"]').boundingBox()
  if (!pn1) throw new Error('pn_1 is not rendered')
  await page.getByRole('button', { name: 'コマを線で分割' }).click()
  // 右上から左下へ、コマの外まで引く。線は伸ばして使うので端はコマの外でもよい
  await page.mouse.move(pn1.x + pn1.width * 0.6, pn1.y + pn1.height * 0.1)
  await page.mouse.down()
  await page.mouse.move(pn1.x + pn1.width * 0.4, pn1.y + pn1.height * 0.9, { steps: 8 })
  await expect(page.locator('[data-draft-cut="pn_1"]')).toBeVisible()
  await page.mouse.up()

  await expect(page.locator('[data-panel-id]')).toHaveCount(7)
  // 斜めに割ったコマは 4 つの頂点のハンドルを出す
  await expect(page.locator('[data-vertex]')).toHaveCount(4)
  const frame = page.locator('[data-panel-id="pn_1"] > [data-panel-frame]')
  const before = await frame.getAttribute('points')

  // 左下の頂点を右へずらす
  const vertex = await page.locator('[data-vertex="3"]').boundingBox()
  if (!vertex) throw new Error('vertex 3 is not rendered')
  const vx = vertex.x + vertex.width / 2
  const vy = vertex.y + vertex.height / 2
  await page.mouse.move(vx, vy)
  await page.mouse.down()
  await page.mouse.move(vx + pn1.width * 0.05, vy, { steps: 6 })
  await page.mouse.up()
  await expect(frame).not.toHaveAttribute('points', before ?? '')
  const after = await frame.getAttribute('points')
  await waitSaved(page)

  await page.reload()
  await expect(page.locator('[data-panel-id]')).toHaveCount(7)
  await expect(page.locator('[data-panel-id="pn_1"] > [data-panel-frame]')).toHaveAttribute(
    'points',
    after ?? '',
  )
})
