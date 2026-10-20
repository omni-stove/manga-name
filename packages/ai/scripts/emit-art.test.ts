import { mkdirSync, writeFileSync } from 'node:fs'
import { fixtures } from '@manga/schema'
import { expect, test } from 'vitest'
import { placeholderPng, placeholderSize } from '../src/placeholder'

// @types/node を入れずに済ませるため、生成を npm script ではなくテストにしている。
// 型はパッケージの tsconfig ではなく、@types/node を持つルートの tsconfig.json で見る。
// placeholderPng を変えたら `pnpm --filter @manga/ai prepare` で作り直す。
test('emits fixtures/art/<panelId>.png for the sample page', () => {
  const dir = new URL('../../../fixtures/art/', import.meta.url)
  mkdirSync(dir, { recursive: true })
  const { settings } = fixtures.samplePage01
  const panels = fixtures.samplePage01.episodes[0]?.pages[0]?.panels ?? []
  for (const panel of panels) {
    writeFileSync(
      new URL(`${panel.id}.png`, dir),
      placeholderPng(panel.order, placeholderSize(panel, settings)),
    )
  }
  expect(panels).toHaveLength(6)
})
