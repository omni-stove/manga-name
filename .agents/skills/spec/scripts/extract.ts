/**
 * git が追跡しているプロダクトのコード（apps/*, packages/*, workers/* の src/ 以下の .ts/.tsx）から JSDoc を抜き出し、
 * 引数のパスの下のファイルについて、パッケージごとに README の本文を添えて、ファイルごとの Markdown で標準出力に出す。
 * JSDoc の無い export も名前を出すので、書き漏れもこの出力で分かる。z.infer で作るだけの型は元のスキーマに任せて出さない。
 * テスト（in-source の `if (import.meta.vitest)` を含む）、stories、生成物、src/dev は仕様ではないので出さない。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse } from '@babel/parser'

type Node = {
  type: string
  start: number
  end: number
  leadingComments?: { type: string; value: string; start: number }[]
  [key: string]: unknown
}

type Entry = { depth: number; label: string; doc: string | undefined }

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

const SOURCE = /^(apps|packages|workers)\/[^/]+\/(src|src-tauri\/src)\/.+\.(ts|tsx)$/
const NOT_SPEC = /(\.test\.tsx?|\.stories\.tsx|\.gen\.ts)$|\/src\/dev\/|\/src\/paraglide\//
// 中身は SQL と Rust で JSDoc を持たないが、D1 のテーブルとデスクトップのネイティブ側がここにしか無いので、在りかだけ出す
const LISTED = /^(workers\/[^/]+\/migrations\/.+\.sql|apps\/[^/]+\/src-tauri\/src\/.+\.rs)$/

const paths = process.argv.slice(2)
if (paths.length === 0) {
  console.error('usage: extract.ts <path>...')
  process.exit(2)
}
const tracked = execFileSync('git', ['ls-files', '--', ...paths], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\n')
  .filter((f) => (SOURCE.test(f) && !NOT_SPEC.test(f)) || LISTED.test(f))

if (tracked.length === 0) {
  console.error(
    `extract: ${paths.join(' ')} の下に apps/*, packages/*, workers/* のソースが無い。パスを直して実行し直す`,
  )
  process.exit(1)
}

const docText = (raw: string) =>
  raw
    .replace(/^\*/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, '').trimEnd())
    .join('\n')
    .trim()

const jsDocOf = (node: Node) => {
  const last = node.leadingComments?.at(-1)
  return last?.type === 'CommentBlock' && last.value.startsWith('*')
    ? docText(last.value)
    : undefined
}

const nameOf = (node: unknown): string | undefined => {
  if (!node || typeof node !== 'object') return undefined
  const n = node as Node
  if (n.type === 'Identifier') return n.name as string
  if (n.type === 'StringLiteral' || n.type === 'NumericLiteral') return String(n.value)
  return undefined
}

const DECLARATION_KEYWORD: Record<string, string> = {
  FunctionDeclaration: 'function',
  ClassDeclaration: 'class',
  TSInterfaceDeclaration: 'interface',
  TSTypeAliasDeclaration: 'type',
  TSEnumDeclaration: 'enum',
}

/** 宣言とプロパティに見出しを付ける。名前の無いもの（式の文など）はソースの先頭行で代える */
const labelOf = (node: Node, source: string): string => {
  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
    const declaration = node.declaration as Node | undefined
    const inner = declaration ? labelOf(declaration, source) : 'export'
    return node.type === 'ExportDefaultDeclaration' ? `export default ${inner}` : `export ${inner}`
  }
  if (node.type === 'VariableDeclaration') {
    const [first] = node.declarations as Node[]
    return `${node.kind} ${nameOf(first?.id) ?? '?'}`
  }
  const keyword = DECLARATION_KEYWORD[node.type]
  if (keyword) return `${keyword} ${nameOf(node.id) ?? ''}`.trim()
  const key = nameOf(node.key)
  if (key) return key
  const firstLine = source.slice(node.start, node.end).split('\n')[0] ?? ''
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine
}

const INFERRED = /^export type \w+ = z\.(infer|input|output)<typeof \w+>$/

const isVitestBlock = (node: Node, source: string) =>
  node.type === 'IfStatement' &&
  source.slice((node.test as Node).start, (node.test as Node).end) === 'import.meta.vitest'

const extract = (file: string): Entry[] => {
  const source = readFileSync(join(root, file), 'utf8')
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['typescript', ...(file.endsWith('.tsx') ? (['jsx'] as const) : [])],
  })
  const entries: Entry[] = []
  const seen = new Set<number>()

  const visit = (node: Node, depth: number) => {
    if (isVitestBlock(node, source)) return
    const doc = jsDocOf(node)
    const comment = node.leadingComments?.at(-1)
    let childDepth = depth
    if (doc && comment && !seen.has(comment.start)) {
      seen.add(comment.start)
      const label = node.type === 'ImportDeclaration' ? '(ファイル)' : labelOf(node, source)
      entries.push({ depth, label, doc })
      childDepth = depth + 1
    } else if (
      depth === 0 &&
      node.type === 'ExportNamedDeclaration' &&
      node.declaration &&
      !INFERRED.test(source.slice(node.start, node.end))
    ) {
      entries.push({ depth, label: labelOf(node, source), doc: undefined })
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments')
        continue
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && typeof (child as Node).type === 'string') {
          visit(child as Node, childDepth)
        }
      }
    }
  }
  for (const statement of ast.program.body as unknown as Node[]) visit(statement, 0)
  return entries
}

const packageOf = (file: string) => {
  let dir = dirname(file)
  while (dir !== '.' && !existsSync(join(root, dir, 'package.json'))) dir = dirname(dir)
  return dir
}

const byPackage = Map.groupBy(tracked, packageOf)
for (const [pkg, files] of byPackage) {
  const manifest = JSON.parse(readFileSync(join(root, pkg, 'package.json'), 'utf8'))
  console.log(`# ${pkg} (${manifest.name})\n`)
  const readme = join(root, pkg, 'README.md')
  if (existsSync(readme)) {
    const body = readFileSync(readme, 'utf8')
      .replace(/^# .*\n/, '')
      .trim()
    if (body) console.log(`${body}\n`)
  }
  for (const file of files) {
    console.log(`## ${file}\n`)
    if (LISTED.test(file)) continue
    for (const { depth, label, doc } of extract(file)) {
      const indent = '  '.repeat(depth)
      const [head = '', ...rest] = (doc ?? '（JSDoc なし）').split('\n')
      console.log(`${indent}- \`${label}\`: ${head}`)
      for (const line of rest) console.log(line ? `${indent}  ${line}` : '')
    }
    console.log()
  }
}
