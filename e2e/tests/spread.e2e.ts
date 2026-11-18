import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { addPage, FIXTURE_PROJECT, importProject } from './app'

test('見開きは右ページから足せ、見開きを割る追加、削除、始まりの切り替えはできない', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  const startsRight = page.getByRole('checkbox', { name: m.web_episode_starts_right() })
  const card = (name: string) => page.getByRole('listitem').filter({ hasText: name })

  // 1 ページ目は左なので、2 ページ目（右）から見開きを始められる
  await expect(card(m.web_episode_page_number({ number: 1 }))).toContainText(
    m.web_episode_page_side_left(),
  )
  await addPage(page, m.web_episode_spread())
  const spreadCard = card(m.web_episode_spread_number({ from: 2, to: 3 }))
  await expect(spreadCard).toBeVisible()

  await addPage(page)
  await expect(card(m.web_episode_page_number({ number: 4 }))).toContainText(
    m.web_episode_page_side_right(),
  )
  // 次は 5 ページ目（左）なので見開きを始められない
  await page.getByRole('button', { name: m.web_episode_add_page() }).click()
  const dialog = page.getByRole('dialog', { name: m.web_episode_add_page() })
  await expect(dialog.getByRole('radio', { name: m.web_episode_spread() })).toBeDisabled()
  await expect(dialog).toContainText(m.web_episode_spread_unavailable())
  await dialog.getByRole('button', { name: m.cancel() }).click()
  await page.getByRole('button', { name: m.web_episode_settings() }).click()
  await expect(startsRight).toBeDisabled()
  await page.getByRole('button', { name: m.cancel() }).click()
  await expect(
    card(m.web_episode_page_number({ number: 1 })).getByRole('button', { name: m.remove() }),
  ).toBeDisabled()
  await expect(
    card(m.web_episode_page_number({ number: 4 })).getByRole('button', {
      name: m.web_episode_move_earlier(),
    }),
  ).toBeDisabled()

  await spreadCard.getByRole('link').click()
  await expect(page.getByRole('application', { name: m.web_editor_canvas() })).toBeVisible()
})
