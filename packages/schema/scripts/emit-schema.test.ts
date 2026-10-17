import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { projectJsonSchema } from '../src/json-schema'

// @types/node を入れずに済ませるため、生成を npm script ではなくテストにしている。
// 型はパッケージの tsconfig ではなく、@types/node を持つルートの tsconfig.json で見る。
test('emits dist/schema.json', () => {
  const url = new URL('../dist/schema.json', import.meta.url)
  mkdirSync(new URL('../dist/', import.meta.url), { recursive: true })
  writeFileSync(url, `${JSON.stringify(projectJsonSchema(), null, 2)}\n`)
  expect(JSON.parse(readFileSync(url, 'utf8')).type).toBe('object')
})
