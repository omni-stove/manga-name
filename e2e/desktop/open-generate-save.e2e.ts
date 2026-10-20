import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { m } from '@manga/i18n'
import { expect } from '@playwright/test'
import { FIXTURE_PROJECT } from '../tests/app'
import { test } from './tauri'

interface SavedProject {
  episodes: { pages: { panels: { artId?: string; arts: { id: string; ref: string }[] }[] }[] }[]
}

const panelInspector = "//*[@data-inspector='panel']"

test('起動してファイルを開き、コマを生成して名前を付けて保存する', async ({ app }) => {
  const { web } = app
  // パスは xdotool で打つので、テスト名の入る outputPath ではなく ASCII だけのディレクトリに保存する
  const saved = join(await mkdtemp(join(tmpdir(), 'manga-e2e-')), 'saved.manga.json')

  await web.waitFor(`//*[normalize-space()='${m.web_project_list()}']`)
  await app.press('ctrl+o')
  await app.openFile(FIXTURE_PROJECT)
  await web.waitFor(`//*[normalize-space()='${m.episode()}']`)

  await web.click(`//a[.//strong[normalize-space()='${m.web_episode_page_number({ number: 1 })}']]`)
  const outlinePanel = m.web_editor_outline_panel({ order: 1 })
  await web.click(
    `//aside//button[normalize-space()='${outlinePanel}' or starts-with(normalize-space(), '${outlinePanel} ')]`,
  )
  await web.click(`${panelInspector}//button[normalize-space()='${m.generate()}']`)
  await web.waitFor(`${panelInspector}//li[@data-art-id]`, 30_000)
  await web.waitFor(`//*[normalize-space()='${m.web_save_status_saved()}']`)

  await app.press('ctrl+shift+s')
  await app.saveFile(saved)
  // 書き終わる前に読むと JSON が途中で切れている
  await expect.poll(() => readFile(saved, 'utf8').then(JSON.parse, () => undefined)).toBeDefined()
  const project = JSON.parse(await readFile(saved, 'utf8')) as SavedProject
  const panels = project.episodes.flatMap((e) => e.pages).flatMap((p) => p.panels)
  const arts = panels.flatMap((p) => p.arts)
  expect(arts).toHaveLength(1)
  expect(panels.filter((p) => p.artId === arts[0]?.id)).toHaveLength(1)
  // ファイルに書くのは ref だけで、絵は AppData のライブラリに置かれている
  const ref = arts[0]?.ref ?? ''
  expect(ref).toMatch(/^file:/)
  const art = await stat(join(app.appData, 'projects', ref.slice('file:'.length)))
  expect(art.size).toBeGreaterThan(0)
})
