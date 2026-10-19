import { m } from '@manga/i18n'
import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openExportDialog, openPage, submitExport } from './app'

test('書き出しダイアログで JSON を選ぶと、ページ用の設定を出さずにプロジェクトを書き出す', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)

  const dialog = await openExportDialog(page)
  await dialog.getByLabel(m.web_export_format()).selectOption('json')
  await expect(dialog.getByLabel(m.web_export_range())).toBeHidden()
  await expect(dialog.getByLabel(m.web_dpi())).toBeHidden()
  const project = JSON.parse((await submitExport(page, dialog)).toString('utf8'))

  expect(project.id).toBe('prj_sample')
  expect(project.episodes[0].pages[0].panels).toHaveLength(6)
  await expect(page.getByRole('dialog', { name: m.web_export_title() })).toBeHidden()
})
