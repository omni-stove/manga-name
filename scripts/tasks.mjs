#!/usr/bin/env node
/**
 * docs/tasks.json の状態を進め、docs/08-tasks.md を生成する。
 * 使い方: node scripts/tasks.mjs <next|show|start|done|render> [id] [--decided]
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const jsonPath = resolve(root, 'docs/tasks.json')
const mdPath = resolve(root, 'docs/08-tasks.md')

const data = JSON.parse(readFileSync(jsonPath, 'utf8'))
const byId = new Map(data.tasks.map((t) => [t.id, t]))
const today = () => new Date().toISOString().slice(0, 10)

const fail = (msg) => {
  console.error(`tasks: ${msg}`)
  process.exit(1)
}

const getTask = (id) => {
  if (!id) fail('id がありません。例: make tasks show 12')
  const t = byId.get(id)
  if (!t) fail(`タスク ${id} は docs/tasks.json にありません`)
  return t
}

const label = (t) => `${t.id} ${t.title}`
const depsDone = (t) => t.deps.every((d) => byId.get(d).status === 'done')
const unmetDeps = (t) => t.deps.filter((d) => byId.get(d).status !== 'done')

const save = () => {
  writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`)
  render()
}

/** 着手中、着手できる、決定待ちのタスクと件数を表示する。 */
const next = () => {
  const inProgress = data.tasks.filter((t) => t.status === 'in_progress')
  const ready = data.tasks.filter((t) => t.status === 'todo' && depsDone(t))
  const open = ready.filter((t) => !t.gates?.length)
  const gated = ready.filter((t) => t.gates?.length)
  if (inProgress.length) {
    console.log('着手中（担当がいる。指名されたときだけ引き継ぐ）')
    for (const t of inProgress) console.log(`  ${label(t)}  since ${t.startedAt}`)
  }
  console.log('着手できる（上から順）')
  if (!open.length) console.log('  なし')
  for (const t of open) console.log(`  ${label(t)}`)
  if (gated.length) {
    console.log('決定待ち（docs/06-open-questions.md で決定済みなら --decided を付けて start）')
    for (const t of gated) console.log(`  ${label(t)}  gates: ${t.gates.join(', ')}`)
  }
  const done = data.tasks.filter((t) => t.status === 'done').length
  console.log(`完了 ${done} / 着手中 ${inProgress.length} / 全 ${data.tasks.length}`)
}

/** タスク 1 件の状態、依存、範囲、完了条件、仕様を表示する。 */
const show = (id) => {
  const t = getTask(id)
  console.log(label(t))
  if (t.detail) console.log(`  ${t.detail}`)
  console.log(
    `状態: ${t.status}${t.startedAt ? `  着手 ${t.startedAt}` : ''}${t.doneAt ? `  完了 ${t.doneAt}` : ''}`,
  )
  console.log('依存:')
  if (!t.deps.length) console.log('  なし')
  for (const d of t.deps) console.log(`  ${label(byId.get(d))}  [${byId.get(d).status}]`)
  for (const g of t.gates ?? []) console.log(`  ${g}  ${data.gates[g]}  [決定待ち]`)
  console.log('範囲:')
  for (const s of t.scope) console.log(`  ${s}`)
  console.log('完了条件:')
  for (const v of t.verify) console.log(`  - ${v}`)
  console.log('仕様:')
  for (const s of t.spec) console.log(`  docs/${s}`)
}

/** 依存が揃った todo のタスクを in_progress にする。gates があるときは decided が必要。 */
const start = (id, decided) => {
  const t = getTask(id)
  if (t.status === 'in_progress') fail(`${label(t)} は ${t.startedAt} に着手済み`)
  if (t.status === 'done') fail(`${label(t)} は ${t.doneAt} に完了済み`)
  const unmet = unmetDeps(t)
  if (unmet.length) fail(`依存が未完了: ${unmet.join(', ')}`)
  if (t.gates?.length && !decided) {
    fail(
      `${t.gates.join(', ')} の決定待ち。docs/06-open-questions.md に決定があるなら --decided を付ける`,
    )
  }
  t.status = 'in_progress'
  t.startedAt = today()
  save()
  console.log(`着手: ${label(t)}`)
}

/** in_progress のタスクを、pnpm check が通ったときだけ done にする。 */
const done = (id) => {
  const t = getTask(id)
  if (t.status === 'todo') fail(`${label(t)} は未着手。先に make tasks start ${id}`)
  if (t.status === 'done') fail(`${label(t)} は ${t.doneAt} に完了済み`)
  try {
    execSync('pnpm check', { cwd: root, stdio: 'inherit' })
  } catch {
    fail('pnpm check が通らないので完了にしない')
  }
  t.status = 'done'
  t.doneAt = today()
  save()
  console.log(`完了: ${label(t)}`)
}

const link = (s) => s.replace(/^([^ ]+\.md)(.*)$/, (_, f, rest) => `[${f}${rest}](${f})`)
const box = (b) => (b ? '[x]' : '[ ]')

/** docs/tasks.json から docs/08-tasks.md を書き出す。 */
function render() {
  const out = []
  const p = (s) => out.push(s)
  const count = (st) => data.tasks.filter((t) => t.status === st).length

  p('# 08. タスク')
  p('')
  p(
    'AI エージェントに 1 つずつ渡す単位に切ったタスク一覧。正は `tasks.json` で、この文書は `make tasks render` で生成する。手で編集しない。',
  )
  p('')
  p('## 原則')
  p('')
  for (const [i, s] of data.principles.entries()) p(`${i + 1}. ${s}`)
  p('')
  p('各タスクは次を持つ。')
  p('')
  p('| 項目 | 内容 |')
  p('|---|---|')
  p('| 依存 | 先に Done になっている必要があるタスク。`Q*` は `06-open-questions.md` の決定待ち |')
  p('| 範囲 | 触ってよいディレクトリ |')
  p(
    '| 完了条件 | 全部通れば Done。テストかコマンドで確認できる形にしてある。「目視」と書いたものだけ人が見る |',
  )
  p('| 仕様 | 着手前に読む文書 |')
  p('')
  p(
    '`05-workstreams.md` の WS ブリーフは仕様として読む。ブリーフにある `contract.ts` への型の写し、モックの置換、Phase 末の統合はこの一覧には無い。schema を最初に終わらせて全員がそれに依存し、毎タスクで apps/web に配線する。',
  )
  p('')
  p('## 進め方')
  p('')
  p('| コマンド | 内容 |')
  p('|---|---|')
  p('| `make tasks next` | 着手できるタスクを列挙する |')
  p('| `make tasks show <id>` | 依存、範囲、完了条件、仕様を表示する |')
  p('| `make tasks start <id>` | 着手にする。依存が未完了なら拒否 |')
  p('| `make tasks done <id>` | `pnpm check` を通してから完了にする |')
  p('')
  p(
    `タスク総数 ${data.tasks.length}。G0 と G1 は直列で、ここがクリティカルパス。G2 以降は依存が揃った順に並列に出せる。`,
  )
  p('')
  p('| 節目 | 条件 | 到達したら |')
  p('|---|---|---|')
  for (const m of data.milestones) {
    const reached = m.after.every((a) => byId.get(a).status === 'done')
    p(`| ${box(reached)} ${m.id} | ${m.after.join(', ')} が Done | ${m.title} |`)
  }
  p('')
  p('## 進捗')
  p('')
  p(`完了 ${count('done')} / 着手中 ${count('in_progress')} / 未着手 ${count('todo')}`)
  p('')
  for (const g of data.groups) {
    p(`### ${g.id} ${g.title}`)
    p('')
    for (const t of data.tasks.filter((t) => t.group === g.id)) {
      const tag =
        t.status === 'in_progress'
          ? `（着手 ${t.startedAt}）`
          : t.status === 'done'
            ? `（完了 ${t.doneAt}）`
            : ''
      p(`- ${box(t.status === 'done')} ${label(t)}${tag}`)
    }
    p('')
  }
  p('## 依存図')
  p('')
  p('実線はタスク間の依存。菱形は未決事項。')
  p('')
  p('```mermaid')
  p('graph LR')
  for (const g of data.groups) {
    p(`  subgraph ${g.id}["${g.id} ${g.title}"]`)
    p('    direction TB')
    for (const t of data.tasks.filter((t) => t.group === g.id)) {
      p(`    T${t.id}["${label(t).replace(/"/g, "'")}"]`)
    }
    p('  end')
  }
  const gates = new Set(data.tasks.flatMap((t) => t.gates ?? []))
  for (const g of gates) p(`  ${g}{{"${g}"}}`)
  for (const t of data.tasks) {
    for (const d of t.deps) p(`  T${d} --> T${t.id}`)
    for (const g of t.gates ?? []) p(`  ${g} --> T${t.id}`)
  }
  p('```')
  p('')
  p('## 全タスク一覧')
  p('')
  for (const g of data.groups) {
    const mode = g.mode === 'serial' ? '直列' : '依存が揃った順に並列'
    p(`### ${g.id} ${g.title}（${mode}）`)
    p('')
    p('| ID | 着手 | 完了 | タスク | 依存 | 範囲 | 完了条件 | 仕様 |')
    p('|---|---|---|---|---|---|---|---|')
    for (const t of data.tasks.filter((t) => t.group === g.id)) {
      const title = t.detail ? `**${t.title}**<br>${t.detail}` : `**${t.title}**`
      const deps = [...t.deps, ...(t.gates ?? [])].join(', ') || 'なし'
      const scope = t.scope.map((s) => `\`${s}\``).join('<br>')
      const verify = t.verify.map((v) => `- ${v}`).join('<br>')
      const spec = t.spec.map(link).join('<br>')
      const started = box(t.status !== 'todo')
      const finished = box(t.status === 'done')
      p(
        `| ${t.id} | ${started} | ${finished} | ${title} | ${deps} | ${scope} | ${verify} | ${spec} |`,
      )
    }
    p('')
  }
  writeFileSync(mdPath, `${out.join('\n').replace(/\n+$/, '')}\n`)
}

const [cmd, id, ...rest] = process.argv.slice(2)
const decided = rest.includes('--decided') || id === '--decided'
switch (cmd) {
  case 'next':
    next()
    break
  case 'show':
    show(id)
    break
  case 'start':
    start(id === '--decided' ? undefined : id, decided)
    break
  case 'done':
    done(id)
    break
  case 'render':
    render()
    console.log(`生成: ${mdPath}`)
    break
  default:
    fail('使い方: make tasks <next|show|start|done|render> [id] [--decided]')
}
