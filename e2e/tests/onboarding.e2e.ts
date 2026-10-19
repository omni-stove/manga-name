import { m } from '@manga/i18n'
import { expect, type Page, test } from '@playwright/test'
import { selectTool, submitExport, waitSaved } from './app'

const STEPS = 10

const tip = (page: Page) =>
  page.getByRole('status').filter({
    hasText: new RegExp(
      `^${m.web_tour_count({ step: '\\d+', total: STEPS })} |${m.web_tour_done()}`,
    ),
  })

/** 吹き出しが `step` 番目の手順を `text` で案内していることを確かめる */
async function expectStep(page: Page, step: number, text: string) {
  await expect(tip(page)).toContainText(m.web_tour_count({ step, total: STEPS }))
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
  await expectStep(page, 1, m.web_tour_project())
  await page.getByLabel(m.project_title()).fill('はじめての作品')
  await page.getByRole('button', { name: m.web_new_project_create(), exact: true }).click()

  await expectStep(page, 2, m.web_tour_character_open())
  await page.getByRole('link', { name: m.character() }).click()
  await expectStep(page, 2, m.web_tour_character_add())
  await page.getByRole('button', { name: m.web_characters_add() }).click()
  await expectStep(page, 2, m.web_tour_character_form())
  await page.getByLabel(m.character_name(), { exact: true }).fill('ミナ')
  await page.getByLabel(m.character_short_name()).fill('ミ')
  await page.getByRole('button', { name: m.add(), exact: true }).click()

  await expectStep(page, 3, m.web_tour_episode_open())
  await page.getByRole('link', { name: m.episode() }).click()
  await page.getByRole('button', { name: m.web_episodes_add() }).click()

  await expectStep(page, 4, m.web_tour_draft_open())
  // 途中で離れても、「はじめに」から同じ手順に戻る
  await waitSaved(page)
  await page.goto('/')
  await page.goto('/onboarding')
  await expect(page).toHaveURL(/\/episodes\/[^/]+$/)
  await expectStep(page, 4, m.web_tour_draft_open())
  await page.getByRole('button', { name: m.web_draft_title() }).click()
  await expect(page.getByLabel(m.web_draft_script())).toHaveValue(
    m.web_tour_script({ name: 'ミナ' }),
  )
  await expect(page.getByLabel(m.web_draft_page_count())).toHaveValue('1')
  await expect(page.getByLabel(m.web_draft_page_count())).toBeDisabled()
  await page.getByRole('button', { name: m.web_draft_plan() }).click()
  await page.getByRole('button', { name: m.web_draft_add_pages({ count: 1 }) }).click()

  await expectStep(page, 5, m.web_tour_page_open())
  await page.getByRole('link', { name: m.web_episode_page_number({ number: 1 }) }).click()
  await expectStep(page, 5, m.web_tour_panels())
  const panel = await inPanel(page, 0, 0.3, 0.3)
  await page.mouse.click(panel.x, panel.y)
  await drag(page, panel, -20, 10)

  await expectStep(page, 6, m.web_tour_bubbles())
  const bubble = await page.locator('[data-bubble-id]').first().boundingBox()
  if (!bubble) throw new Error('no bubble')
  const center = { x: bubble.x + bubble.width / 2, y: bubble.y + bubble.height / 2 }
  await page.mouse.click(center.x, center.y)
  await drag(page, center, 10, 10)

  await expectStep(page, 7, m.web_tour_hints())
  await selectTool(page, m.focus_point())
  const focus = await inPanel(page, 1, 0.5, 0.5)
  await page.mouse.click(focus.x, focus.y)
  await selectTool(page, m.vector())
  await drag(page, await inPanel(page, 2, 0.2, 0.5), 60, 0)

  await expectStep(page, 8, m.web_tour_generate())
  await page.getByRole('button', { name: m.inspector_page_generate_all() }).click()

  await expectStep(page, 9, m.web_tour_layers())
  await page.getByRole('checkbox', { name: m.web_editor_layer_hints() }).uncheck()

  await expectStep(page, 10, m.web_tour_export())
  await page.getByRole('button', { name: m.web_editor_export(), exact: true }).click()
  await submitExport(page, page.getByRole('dialog', { name: m.web_export_title() }))

  await expect(tip(page)).toContainText(m.web_tour_done())
  await page.getByRole('link', { name: m.web_project_list() }).click()
  await expect(tip(page)).toHaveCount(0)
  // 案内で作ったプロジェクトは自分のプロジェクトとして一覧に残る
  await expect(page.getByText('はじめての作品')).toBeVisible()
})
