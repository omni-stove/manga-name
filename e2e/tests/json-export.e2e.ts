import { expect, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openExportDialog, openPage, submitExport } from './app'

test('書き出しダイアログで JSON を選ぶと、ページ用の設定を出さずにプロジェクトを書き出す', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await openPage(page, 1)

  const dialog = await openExportDialog(page)
  await dialog.getByLabel('形式').selectOption('json')
  await expect(dialog.getByLabel('範囲')).toBeHidden()
  await expect(dialog.getByLabel('dpi')).toBeHidden()
  const project = JSON.parse((await submitExport(page, dialog)).toString('utf8'))

  expect(project.id).toBe('prj_sample')
  expect(project.episodes[0].pages[0].panels).toHaveLength(6)
  await expect(page.getByRole('dialog', { name: '書き出し' })).toBeHidden()
})
