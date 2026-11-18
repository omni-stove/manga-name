import { m } from '@manga/i18n'
import { expect, type Page, test } from '@playwright/test'
import {
  addPage,
  clickInsidePanel,
  comparePng,
  FIXTURE_PROJECT,
  importProject,
  openExportDialog,
  openPage,
  panelInspector,
  pngSize,
  readPdfSheets,
  selectPanel,
  selectTool,
  submitExport,
} from './app'

/** 開いているページを format で書き出す。ダイアログは前回の形式を覚えていることがあるので、毎回選び直す */
async function exportAs(page: Page, format: 'png' | 'pdf'): Promise<Buffer> {
  const dialog = await openExportDialog(page)
  await dialog.getByLabel(m.web_export_format()).selectOption(format)
  if (format === 'png') await dialog.getByLabel(m.web_export_panel_numbers()).setChecked(false)
  return submitExport(page, dialog)
}

test('新しいテンプレートで足したページに新しい効果・フキダシの形・漫符と柱を置くと、編集画面に描かれ、診断に出て、PNG と PDF に書き出せる', async ({
  page,
}) => {
  await importProject(page, FIXTURE_PROJECT)
  await addPage(page, m.web_page_template_3rows_split_middle())
  await openPage(page, 2)
  const plainPng = await exportAs(page, 'png')
  const [plainSheet] = await readPdfSheets(await exportAs(page, 'pdf'))

  // 何も選んでいない間はページのインスペクタが開いている
  const hashira = page.getByLabel(m.page_hashira(), { exact: true })
  await hashira.fill('次号、ついに対決！')
  await hashira.blur()
  await expect(page.locator('[data-hashira]')).toHaveCount(1)

  const effects = ['vertical_lines', 'crosshatch', 'sparkle', 'flowers'] as const
  for (const [i, effect] of effects.entries()) {
    const order = i + 1
    await selectPanel(page, order)
    await panelInspector(page).getByLabel(m.panel_effect(), { exact: true }).selectOption(effect)
    await expect(page.locator(`[data-panel-effect="${effect}"]`)).toHaveCount(1)
    // 読み順 1〜3 のコマを同じ寄りにして、寄りの単調さを診断させる
    if (order <= 3) {
      await panelInspector(page).getByLabel(m.panel_camera(), { exact: true }).selectOption('bust')
    }
  }

  await selectTool(page, m.bubble())
  const bubbleInspector = page.locator('[data-inspector="bubble"]')
  for (const [index, shape] of [
    [0, 'cold'],
    [1, 'weak'],
  ] as const) {
    await clickInsidePanel(page, index)
    await expect(bubbleInspector).toBeVisible()
    const text = bubbleInspector.getByLabel(m.bubble_text())
    // 41 字で、フキダシの字数の多さを診断させる
    await text.fill(shape === 'cold' ? 'あ'.repeat(41) : 'もう…だめ…')
    await text.blur()
    await bubbleInspector.getByLabel(m.bubble_shape(), { exact: true }).selectOption(shape)
    await expect(page.locator(`.ec-bubble[data-shape="${shape}"]`)).toHaveCount(1)
  }

  await selectTool(page, m.focus_point())
  await page
    .getByRole('group', { name: m.web_editor_focus_kind() })
    .getByText(m.focus_point_kind_mark(), { exact: true })
    .click()
  await clickInsidePanel(page, 2)
  const focusInspector = page.locator('[data-inspector="focus"]')
  await expect(focusInspector.getByLabel(m.focus_point_kind(), { exact: true })).toHaveValue('mark')
  const marks = page.locator('[data-panel-marks]')
  await expect(marks).toHaveCount(1)
  const markSelect = focusInspector.getByLabel(m.focus_point_mark(), { exact: true })
  await expect(markSelect).toHaveValue('sweat')
  let shape = await marks.getAttribute('d')
  for (const mark of ['anger', 'question', 'exclaim', 'sigh'] as const) {
    await markSelect.selectOption(mark)
    await expect(marks).not.toHaveAttribute('d', shape ?? '')
    shape = await marks.getAttribute('d')
  }

  const issues = page.locator('[data-section="issues"]')
  await expect(issues.locator('[data-code="TOO_MUCH_TEXT"]')).toHaveCount(1)
  await expect(issues.locator('[data-code="MONOTONOUS_CAMERA"]')).toHaveCount(1)

  const stagedPng = await exportAs(page, 'png')
  expect(pngSize(stagedPng)).toEqual(pngSize(plainPng))
  // 4 コマの効果と漫符、フキダシ、柱が足されたので、縮めて比べても画素の平均がはっきり変わる
  expect((await comparePng(page, stagedPng, plainPng)).mean).toBeGreaterThan(1)

  const sheets = await readPdfSheets(await exportAs(page, 'pdf'))
  expect(sheets).toHaveLength(1)
  const [staged] = sheets
  expect(staged?.images).toHaveLength(1)
  expect(staged?.width).toBeCloseTo(plainSheet?.width ?? 0, 0)
  // 効果の線と漫符で黒い画素が増え、何も置かないページより暗くなる
  expect(staged?.images[0]?.brightness ?? 255).toBeLessThan(plainSheet?.images[0]?.brightness ?? 0)
})
