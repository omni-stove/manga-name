import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject } from './app'

test('見開きは右ページから足せ、見開きを割る追加、削除、始まりの切り替えはできない', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  const spread = page.getByRole('checkbox', { name: m.web_episode_spread() })
  const startsRight = page.getByRole('checkbox', { name: m.web_episode_starts_right() })
  const add = page.getByRole('button', { name: m.web_episode_add_page() })
  const card = (name: string) => page.getByRole('listitem').filter({ hasText: name })

  // 1 ページ目は左なので、2 ページ目（右）から見開きを始められる
  await expect(card(m.web_episode_page_number({ number: 1 }))).toContainText(
    m.web_episode_page_side_left(),
  )
  await spread.check()
  await add.click()
  const spreadCard = card(m.web_episode_spread_number({ from: 2, to: 3 }))
  await expect(spreadCard).toBeVisible()

  await spread.uncheck()
  await add.click()
  await expect(card(m.web_episode_page_number({ number: 4 }))).toContainText(
    m.web_episode_page_side_right(),
  )
  // 次は 5 ページ目（左）なので見開きを始められない
  await expect(spread).toBeDisabled()
  await expect(startsRight).toBeDisabled()
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
