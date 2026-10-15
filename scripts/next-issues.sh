#!/bin/sh
# 親 Issue のチェックリストから、依存がすべて終わって着手できる Issue 番号を 1 行ずつ出す。
# 使い方: scripts/next-issues.sh <親 Issue 本文のファイル> <Issue 一覧 JSON のファイル>
#   Issue 一覧は `gh issue list --state all --json number,state,labels` の出力。
# チェックリストの行は "- [ ] #9 task 08（依存: 07→#5, 03→#4）" の形。行の最初の #N がその Issue、
# 残りの #N が依存。チェック済みか close 済みなら終わったとみなす。
# 出すのは open で implementation ラベルがまだ無く、依存がすべて終わった Issue。
# 「決定待ち」を含む行は人の判断が要るので出さない。
# node に依存しないのは、CI でも同じコマンドが動くようにするため。
set -eu

[ $# -eq 2 ] || {
  echo '使い方: scripts/next-issues.sh <親 Issue 本文のファイル> <Issue 一覧 JSON のファイル>' >&2
  exit 1
}

jq -r --rawfile body "$1" '
  (map({key: (.number | tostring), value: {
    closed: (.state == "CLOSED"),
    labeled: any(.labels[].name; . == "implementation")
  }}) | from_entries) as $issues
  | [ $body | split("\n")[]
      | select(test("^- \\[[ x]\\] #[0-9]+"))
      | { checked: test("^- \\[x\\]"),
          gated: test("決定待ち"),
          refs: [match("#([0-9]+)"; "g").captures[0].string] }
      | { number: .refs[0], deps: .refs[1:], checked, gated }
    ] as $items
  | [ $items[] | select(.checked) | .number ] as $checked
  | def done($n): any($checked[]; . == $n) or ($issues[$n].closed // false);
  $items[]
  | select(.checked or .gated | not)
  | select($issues[.number] != null)
  | select($issues[.number].closed or $issues[.number].labeled | not)
  | select(all(.deps[]; done(.)))
  | .number
' "$2"
