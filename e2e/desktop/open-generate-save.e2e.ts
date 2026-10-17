import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  await web.waitFor("//*[normalize-space()='プロジェクト一覧']")
  await app.press('ctrl+o')
  await app.openFile(FIXTURE_PROJECT)
  await web.waitFor("//*[normalize-space()='エピソード']")

  await web.click("//a[.//strong[normalize-space()='1 ページ']]")
  await web.click(
    "//aside//button[normalize-space()='コマ 1' or starts-with(normalize-space(), 'コマ 1 ')]",
  )
  await web.click(`${panelInspector}//button[normalize-space()='生成']`)
  await web.waitFor(`${panelInspector}//li[@data-art-id]`, 30_000)
  await web.waitFor("//*[normalize-space()='保存済み']")

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
