/**
 * Desktop のバージョンを `package.json` と `src-tauri/tauri.conf.json` で揃える。
 *
 * - `node scripts/version.ts check [tag]`: 2 つが一致しなければ終了コード 1。`tag`（`v1.2.3`）を渡すと、それとも一致するかを見る
 * - `node scripts/version.ts set <version>`: 両方を `version` に書き換える
 *
 * `pnpm --filter @manga/desktop version:check` と `version:set` から呼ぶ。
 */
import { readFile, writeFile } from 'node:fs/promises'

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

const files = [
  new URL('../package.json', import.meta.url),
  new URL('../src-tauri/tauri.conf.json', import.meta.url),
]

const readJson = async (file: URL): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(file, 'utf8'))

const [command, arg] = process.argv.slice(2)

if (command === 'set') {
  if (!arg || !SEMVER.test(arg)) {
    console.error(`semver ではない: ${arg ?? '(なし)'}`)
    process.exit(1)
  }
  for (const file of files) {
    const json = await readJson(file)
    json.version = arg
    await writeFile(file, `${JSON.stringify(json, null, 2)}\n`)
  }
  console.log(`version を ${arg} にした`)
} else if (command === 'check') {
  const versions = await Promise.all(
    files.map(async (file) => ({ file: file.pathname, version: (await readJson(file)).version })),
  )
  if (arg) versions.push({ file: 'tag', version: arg.replace(/^v/, '') })
  const [first] = versions
  if (versions.some((entry) => entry.version !== first?.version)) {
    for (const entry of versions)
      console.error(`${String(entry.version).padStart(12)}  ${entry.file}`)
    console.error('version が一致しない')
    process.exit(1)
  }
  console.log(`version ${first?.version} で一致している`)
} else {
  console.error('使い方: node scripts/version.ts check [tag] | set <version>')
  process.exit(1)
}
