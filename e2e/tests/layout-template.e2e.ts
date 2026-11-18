import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import {
  addPage,
  clickInsidePanel,
  FIXTURE_EPISODE,
  FIXTURE_PROJECT,
  importProject,
  openPage,
  panelInspector,
} from './app'

test('組み込みのテンプレートを選んでページを足すと、そのコマ割りのページができ、インセットの小さいコマを選べる', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  const builtIns = [
    { label: m.web_page_template_one_panel(), panels: 1 },
    { label: m.web_page_template_3rows_split_middle(), panels: 4 },
    { label: m.web_page_template_3rows_split_top(), panels: 5 },
    { label: m.web_page_template_diagonal(), panels: 5 },
    { label: m.web_page_template_inset(), panels: 3 },
  ]
  for (const [i, { label, panels }] of builtIns.entries()) {
    await addPage(page, label)
    await expect(
      page.getByRole('listitem').filter({ hasText: m.web_episode_page_number({ number: i + 2 }) }),
    ).toContainText(m.web_episode_page_summary({ panels }))
  }

  await openPage(page, builtIns.length + 1)
  // 描く順の 0 番目は紙面いっぱいの下敷き、1 番目が読み始めの小さいコマ
  await clickInsidePanel(page, 1)
  await expect(
    panelInspector(page).getByText(m.inspector_panel_title({ order: 2 }), { exact: true }),
  ).toBeVisible()
})

test('ページのコマ割りをテンプレートに登録し、そのテンプレートでページを足して、確認を経て登録を消せる', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)
  // 左上の隅は作業台
  await page
    .getByRole('application', { name: m.web_editor_canvas() })
    .click({ button: 'right', position: { x: 4, y: 4 } })
  await page.getByRole('menuitem', { name: m.web_editor_menu_register_layout() }).click()
  const register = page.getByRole('dialog', { name: m.web_layout_template_register_title() })
  await register.getByLabel(m.layout_template_name()).fill('6 コマの基本')
  await register.getByRole('button', { name: m.web_layout_template_register() }).click()
  await expect(register).toBeHidden()
  await expect(
    page.getByText(m.web_layout_template_registered({ name: '6 コマの基本' })),
  ).toBeVisible()

  await page.getByRole('link', { name: FIXTURE_EPISODE }).click()
  await addPage(page, '6 コマの基本')
  const added = page
    .getByRole('listitem')
    .filter({ hasText: m.web_episode_page_number({ number: 2 }) })
  await expect(added).toContainText(m.web_episode_page_summary({ panels: 6 }))

  await page.getByRole('button', { name: m.web_episode_add_page() }).click()
  const adding = page.getByRole('dialog', { name: m.web_episode_add_page() })
  await adding
    .getByRole('button', { name: m.web_layout_template_remove_named({ name: '6 コマの基本' }) })
    .click()
  const dialog = page.getByRole('dialog', { name: m.web_episode_remove_template() })
  await expect(dialog).toContainText(
    m.web_episode_remove_template_confirm({ name: '6 コマの基本' }),
  )
  await dialog.getByRole('button', { name: m.remove() }).click()
  await expect(adding.getByRole('radio', { name: '6 コマの基本' })).toHaveCount(0)
  await expect(
    adding.getByRole('radio', { name: m.web_page_template_3rows(), exact: true }),
  ).toBeChecked()
})
