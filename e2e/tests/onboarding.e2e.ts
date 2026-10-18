import { expect, type Page, test } from '@playwright/test'
import { selectTool, submitExport, waitSaved } from './app'

const tip = (page: Page) =>
  page.getByRole('status').filter({ hasText: /^\d+ \/ 10 |1 ページできました/ })

/** 吹き出しが `step` 番目の手順を `text` で案内していることを確かめる */
async function expectStep(page: Page, step: number, text: string | RegExp) {
  await expect(tip(page)).toContainText(`${step} / 10`)
  await expect(tip(page)).toContainText(text)
}

/** `n` 番目のコマの、幅と高さに対する `fx`, `fy` の位置 */
async function inPanel(page: Page, n: number, fx: number, fy: number) {
  const box = await page.locator('[data-panel-id]').nth(n).boundingBox()
  if (!box) throw new Error(`panel ${n} is not rendered`)
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
  await page.mouse.up()
}

test('「はじめに」は作る順に 1 手順ずつ案内し、終えた手順で次へ進み、ページを離れても続きから再開する', async ({
  page,
}) => {
  await page.goto('/onboarding')
  await expect(page).toHaveURL(/\/new$/)
  await expectStep(page, 1, '作品の題')
  await page.getByLabel('タイトル').fill('はじめての作品')
  await page.getByRole('button', { name: '作成', exact: true }).click()

  await expectStep(page, 2, '「キャラクター」を開いて')
  await page.getByRole('link', { name: 'キャラクター' }).click()
  await expectStep(page, 2, '「キャラクターを追加」')
  await page.getByRole('button', { name: 'キャラクターを追加' }).click()
  await expectStep(page, 2, '参照画像')
  await page.getByLabel('名前', { exact: true }).fill('ミナ')
  await page.getByLabel('略称').fill('ミ')
  await page.getByRole('button', { name: '追加', exact: true }).click()

  await expectStep(page, 3, '「エピソード」を開いて')
  await page.getByRole('link', { name: 'エピソード' }).click()
  await page.getByRole('button', { name: 'エピソードを追加' }).click()

  await expectStep(page, 4, '「脚本から下書き」')
  // 途中で離れても、「はじめに」から同じ手順に戻る
  await waitSaved(page)
  await page.goto('/')
  await page.goto('/onboarding')
  await expect(page).toHaveURL(/\/episodes\/[^/]+$/)
  await expectStep(page, 4, '「脚本から下書き」')
  await page.getByRole('button', { name: '脚本から下書き' }).click()
  await expect(page.getByLabel('脚本')).toHaveValue(/ミナ「遅刻、遅刻！」/)
  await expect(page.getByLabel('ページ数')).toHaveValue('1')
  await expect(page.getByLabel('ページ数')).toBeDisabled()
  await page.getByRole('button', { name: 'ページ割りを作る' }).click()
  await page.getByRole('button', { name: /ページを追加$/ }).click()

  await expectStep(page, 5, 'ページができました')
  await page.getByRole('link', { name: '1 ページ' }).click()
  await expectStep(page, 5, 'コマを 1 つ選び')
  const panel = await inPanel(page, 0, 0.3, 0.3)
  await page.mouse.click(panel.x, panel.y)
  await drag(page, panel, -20, 10)

  await expectStep(page, 6, 'フキダシを 1 つドラッグ')
  const bubble = await page.locator('[data-bubble-id]').first().boundingBox()
  if (!bubble) throw new Error('no bubble')
  const center = { x: bubble.x + bubble.width / 2, y: bubble.y + bubble.height / 2 }
  await page.mouse.click(center.x, center.y)
  await drag(page, center, 10, 10)

  await expectStep(page, 7, '「焦点」')
  await selectTool(page, '焦点')
  const focus = await inPanel(page, 1, 0.5, 0.5)
  await page.mouse.click(focus.x, focus.y)
  await selectTool(page, 'ベクトル')
  await drag(page, await inPanel(page, 2, 0.2, 0.5), 60, 0)

  await expectStep(page, 8, 'コマに絵を入れます')
  await page.getByRole('button', { name: 'このページを全部生成' }).click()

  await expectStep(page, 9, '「ヒント」を外す')
  await page.getByRole('checkbox', { name: 'ヒント' }).uncheck()

  await expectStep(page, 10, '「書き出し」')
  await page.getByRole('button', { name: '書き出し', exact: true }).click()
  await submitExport(page, page.getByRole('dialog', { name: '書き出し' }))

  await expect(tip(page)).toContainText('1 ページできました')
  await page.getByRole('link', { name: 'プロジェクト一覧' }).click()
  await expect(tip(page)).toHaveCount(0)
  // 案内で作ったプロジェクトは自分のプロジェクトとして一覧に残る
  await expect(page.getByText('はじめての作品')).toBeVisible()
})
