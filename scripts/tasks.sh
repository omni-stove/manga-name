#!/bin/sh
# docs/tasks.json の状態を進め、docs/08-tasks.md を生成する。
# 使い方: scripts/tasks.sh <next|show|start|done|render> [id] [--decided]
# node に依存しないのは、issue worker の CI でも同じコマンドが動くようにするため。
set -eu
cd "$(dirname "$0")/.."
json=docs/tasks.json
md=docs/08-tasks.md

fail() {
  echo "tasks: $1" >&2
  exit 1
}

# $1 のタスクを返す。無ければ失敗する。
task() {
  [ -n "${1:-}" ] || fail 'id がありません。例: make tasks show 12'
  jq -e --arg id "$1" '.tasks[] | select(.id == $id)' "$json" >/dev/null 2>&1 ||
    fail "タスク $1 は $json にありません"
}

# タスク $1 のフィールド $2 を出す。
field() {
  jq -r --arg id "$1" --arg k "$2" '.tasks[] | select(.id == $id) | .[$k] // ""' "$json"
}

label() {
  jq -r --arg id "$1" '.tasks[] | select(.id == $id) | "\(.id) \(.title)"' "$json"
}

# $1 のフィルタで $json を書き換え、docs/08-tasks.md を生成し直す。
save() {
  tmp=$(mktemp)
  jq --indent 2 --arg id "$id" --arg today "$(date -u +%F)" "$1" "$json" >"$tmp"
  mv "$tmp" "$json"
  render
}

next() {
  jq -r '
    . as $d
    | ($d.tasks | map({ key: .id, value: .status }) | from_entries) as $st
    | def name: "\(.id) \(.title)";
      def deps_done: all(.deps[]; $st[.] == "done");
      [$d.tasks[] | select(.status == "in_progress")] as $ip
    | [$d.tasks[] | select(.status == "todo" and deps_done)] as $ready
    | [$ready[] | select((.gates // []) | length == 0)] as $open
    | [$ready[] | select((.gates // []) | length > 0)] as $gated
    | (if ($ip | length) > 0 then
        "着手中（担当がいる。指名されたときだけ引き継ぐ）",
        ($ip[] | "  \(name)  since \(.startedAt)")
      else empty end),
      "着手できる（上から順）",
      (if ($open | length) == 0 then "  なし" else ($open[] | "  \(name)") end),
      (if ($gated | length) > 0 then
        "決定待ち（docs/06-open-questions.md で決定済みなら --decided を付けて start）",
        ($gated[] | "  \(name)  gates: \(.gates | join(", "))")
      else empty end),
      "完了 \([$d.tasks[] | select(.status == "done")] | length) / 着手中 \($ip | length) / 全 \($d.tasks | length)"
  ' "$json"
}

show() {
  task "$1"
  jq -r --arg id "$1" '
    . as $d
    | ($d.tasks | map({ key: .id, value: . }) | from_entries) as $by
    | def name: "\(.id) \(.title)";
      $by[$id] as $t
    | ($t | name),
      (if $t.detail then "  \($t.detail)" else empty end),
      "状態: \($t.status)\(if $t.startedAt then "  着手 \($t.startedAt)" else "" end)\(if $t.doneAt then "  完了 \($t.doneAt)" else "" end)",
      "依存:",
      (if ($t.deps | length) == 0 then "  なし" else ($t.deps[] | $by[.] | "  \(name)  [\(.status)]") end),
      (($t.gates // [])[] | "  \(.)  \($d.gates[.])  [決定待ち]"),
      "範囲:", ($t.scope[] | "  \(.)"),
      "完了条件:", ($t.verify[] | "  - \(.)"),
      "仕様:", ($t.spec[] | "  docs/\(.)")
  ' "$json"
}

# 依存が揃った todo のタスクを in_progress にする。gates があるときは --decided が要る。
start() {
  task "$1"
  id=$1
  case $(field "$id" status) in
    in_progress) fail "$(label "$id") は $(field "$id" startedAt) に着手済み" ;;
    done) fail "$(label "$id") は $(field "$id" doneAt) に完了済み" ;;
  esac
  unmet=$(jq -r --arg id "$id" '
    . as $d | ($d.tasks | map({ key: .id, value: .status }) | from_entries) as $st
    | $d.tasks[] | select(.id == $id) | [.deps[] | select($st[.] != "done")] | join(", ")' "$json")
  [ -z "$unmet" ] || fail "依存が未完了: $unmet"
  gates=$(jq -r --arg id "$id" '.tasks[] | select(.id == $id) | .gates // [] | join(", ")' "$json")
  if [ -n "$gates" ] && [ "$2" != 1 ]; then
    fail "$gates の決定待ち。docs/06-open-questions.md に決定があるなら --decided を付ける"
  fi
  save '(.tasks[] | select(.id == $id)) |= (.status = "in_progress" | .startedAt = $today)'
  echo "着手: $(label "$id")"
}

# in_progress のタスクを done にする。検証はしない。
done_() {
  task "$1"
  id=$1
  case $(field "$id" status) in
    todo) fail "$(label "$id") は未着手。先に make tasks start $id" ;;
    done) fail "$(label "$id") は $(field "$id" doneAt) に完了済み" ;;
  esac
  save '(.tasks[] | select(.id == $id)) |= (.status = "done" | .doneAt = $today)'
  echo "完了: $(label "$id")"
}

# docs/tasks.json から docs/08-tasks.md を書き出す。
render() {
  out=$(jq -r '
    . as $d
    | ($d.tasks | map({ key: .id, value: . }) | from_entries) as $by
    | def name: "\(.id) \(.title)";
      def box: if . then "[x]" else "[ ]" end;
      def count($s): [$d.tasks[] | select(.status == $s)] | length;
      def link: if test("^[^ ]+\\.md") then (capture("^(?<f>[^ ]+\\.md)(?<r>.*)$") | "[\(.f)\(.r)](\(.f))") else . end;
      def in_group($g): $d.tasks[] | select(.group == $g.id);
      "# 08. タスク",
      "",
      "AI エージェントに 1 つずつ渡す単位に切ったタスク一覧。正は `tasks.json` で、この文書は `make tasks render` で生成する。手で編集しない。",
      "",
      "## 原則",
      "",
      ($d.principles | to_entries[] | "\(.key + 1). \(.value)"),
      "",
      "各タスクは次を持つ。",
      "",
      "| 項目 | 内容 |",
      "|---|---|",
      "| 依存 | 先に Done になっている必要があるタスク。`Q*` は `06-open-questions.md` の決定待ち |",
      "| 範囲 | 触ってよいディレクトリ |",
      "| 完了条件 | 実装が満たすべき条件。Done の判定には使わない |",
      "| 仕様 | 着手前に読む文書 |",
      "",
      "`05-workstreams.md` の WS ブリーフは仕様として読む。ブリーフにある `contract.ts` への型の写し、モックの置換、Phase 末の統合はこの一覧には無い。schema を最初に終わらせて全員がそれに依存し、毎タスクで apps/web に配線する。",
      "",
      "## 進め方",
      "",
      "| コマンド | 内容 |",
      "|---|---|",
      "| `make tasks next` | 着手できるタスクを列挙する |",
      "| `make tasks show <id>` | 依存、範囲、完了条件、仕様を表示する |",
      "| `make tasks start <id>` | 着手にする。依存が未完了なら拒否 |",
      "| `make tasks done <id>` | 完了にする。検証はしない |",
      "",
      "タスク総数 \($d.tasks | length)。G0 と G1 は直列で、ここがクリティカルパス。G2 以降は依存が揃った順に並列に出せる。",
      "",
      "| 節目 | 条件 | 到達したら |",
      "|---|---|---|",
      ($d.milestones[] | "| \(all(.after[]; $by[.].status == "done") | box) \(.id) | \(.after | join(", ")) が Done | \(.title) |"),
      "",
      "## 進捗",
      "",
      "完了 \(count("done")) / 着手中 \(count("in_progress")) / 未着手 \(count("todo"))",
      "",
      ($d.groups[] | . as $g
        | "### \($g.id) \($g.title)",
          "",
          (in_group($g) | "- \(.status == "done" | box) \(name)\(if .status == "in_progress" then "（着手 \(.startedAt)）" elif .status == "done" then "（完了 \(.doneAt)）" else "" end)"),
          ""),
      "## 依存図",
      "",
      "実線はタスク間の依存。菱形は未決事項。",
      "",
      "```mermaid",
      "graph LR",
      ($d.groups[] | . as $g
        | "  subgraph \($g.id)[\"\($g.id) \($g.title)\"]",
          "    direction TB",
          (in_group($g) | "    T\(.id)[\"\(name | gsub("\""; "'"'"'"))\"]"),
          "  end"),
      ([$d.tasks[].gates[]?] | reduce .[] as $g ([]; if index($g) then . else . + [$g] end) | .[] | "  \(.){{\"\(.)\"}}"),
      ($d.tasks[] | . as $t | (.deps[] | "  T\(.) --> T\($t.id)"), ((.gates // [])[] | "  \(.) --> T\($t.id)")),
      "```",
      "",
      "## 全タスク一覧",
      "",
      ($d.groups[] | . as $g
        | "### \($g.id) \($g.title)（\(if $g.mode == "serial" then "直列" else "依存が揃った順に並列" end)）",
          "",
          "| ID | 着手 | 完了 | タスク | 依存 | 範囲 | 完了条件 | 仕様 |",
          "|---|---|---|---|---|---|---|---|",
          (in_group($g)
            | "| \(.id) | \(.status != "todo" | box) | \(.status == "done" | box) | \(if .detail then "**\(.title)**<br>\(.detail)" else "**\(.title)**" end) | \((.deps + (.gates // [])) | join(", ") | if . == "" then "なし" else . end) | \(.scope | map("`\(.)`") | join("<br>")) | \(.verify | map("- \(.)") | join("<br>")) | \(.spec | map(link) | join("<br>")) |"),
          "")
  ' "$json")
  printf '%s\n' "$out" >"$md"
}

cmd=${1:-}
id=${2:-}
decided=0
for a in "$@"; do [ "$a" = --decided ] && decided=1; done
[ "$id" = --decided ] && id=
case $cmd in
  next) next ;;
  show) show "$id" ;;
  start) start "$id" "$decided" ;;
  done) done_ "$id" ;;
  render) render; echo "生成: $md" ;;
  *) fail '使い方: make tasks <next|show|start|done|render> [id] [--decided]' ;;
esac
