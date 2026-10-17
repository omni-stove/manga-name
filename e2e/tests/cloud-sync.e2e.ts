import { expect, test } from '@playwright/test'
import {
  arts,
  clickInsidePanel,
  createProject,
  inspector,
  openPage,
  panelInspector,
  selectPanel,
  selectTool,
  waitSaved,
} from './app'
import { fakeGoogleAccount, signIn, uniqueUser, waitSynced } from './cloud'

test('ログインしてクラウドに保存し、別のブラウザで開くと本文と生成画像が見え、次の保存もリロードで見える', async ({
  browser,
}) => {
  const user = uniqueUser()
  const title = `e2e シナリオ 7 ${Date.now()}`

  // Cookie も IndexedDB も分かれた 2 つのブラウザ
  const first = await browser.newContext()
  const second = await browser.newContext()
  await fakeGoogleAccount(first, user)
  await fakeGoogleAccount(second, user)
  const a = await first.newPage()
  const b = await second.newPage()

  await signIn(a)
  await createProject(a, title)
  await a.getByRole('button', { name: 'ページを追加' }).click()
  await openPage(a, 1)

  await selectTool(a, 'フキダシ')
  await clickInsidePanel(a, 0)
  const bubble = a.locator('[data-inspector="bubble"]')
  await bubble.getByLabel('セリフ').fill('こんにちは')
  await bubble.getByLabel('セリフ').blur()
  await expect(inspector(a).getByRole('button', { name: 'フキダシ 1 こんにちは' })).toBeVisible()

  await selectTool(a, '選択')
  await selectPanel(a, 1)
  await panelInspector(a).getByRole('button', { name: '生成', exact: true }).click()
  await expect(arts(a)).toHaveCount(1)
  await expect(a.locator('[data-panel-id] image')).toHaveCount(1)
  await waitSaved(a)
  await waitSynced(a)

  // 手元に無いプロジェクトはクラウドの一覧から開く
  await signIn(b)
  await b.getByRole('link', { name: title }).click()
  await expect(b.getByText('ページ一覧', { exact: true })).toBeVisible()
  await openPage(b, 1)
  await expect(inspector(b).getByRole('button', { name: 'フキダシ 1 こんにちは' })).toBeVisible()
  // 生成画像は r2: の ref で届き、API から読んで描く
  await expect(b.locator('[data-panel-id] image')).toHaveCount(1)
  await selectPanel(b, 1)
  await expect(arts(b)).toHaveCount(1)
  await expect(arts(b).first()).toHaveAttribute('data-current', 'true')

  await inspector(a).getByRole('button', { name: 'フキダシ 1 こんにちは' }).click()
  await bubble.getByLabel('セリフ').fill('またね')
  await bubble.getByLabel('セリフ').blur()
  await expect(inspector(a).getByRole('button', { name: 'フキダシ 1 またね' })).toBeVisible()
  await waitSaved(a)
  await waitSynced(a)

  await b.reload()
  await expect(inspector(b).getByRole('button', { name: 'フキダシ 1 またね' })).toBeVisible()
  await expect(b.locator('[data-panel-id] image')).toHaveCount(1)
  // 取り込んだだけの側は送り返さないので、競合にならない
  await expect(b.getByText('同期済み', { exact: true })).toBeVisible()

  await first.close()
  await second.close()
})
