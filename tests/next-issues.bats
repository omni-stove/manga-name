#!/usr/bin/env bats
# scripts/next-issues.sh が親 Issue のチェックリストと Issue 一覧から着手できる Issue を選ぶことを確認する。
# テスト名は ASCII にする。bats は非 UTF-8 ロケールで実行されると日本語名を解決できない。

setup() {
  cd "$BATS_TEST_DIRNAME/.."
  body="$BATS_TEST_TMPDIR/body.md"
  issues="$BATS_TEST_TMPDIR/issues.json"
  cat >"$body" <<'MD'
## 目的

- [x] #4 task 03 基盤
- [ ] #5 task 07 雛形
- [x] #6 task 04（依存: 03→#4）
- [ ] #9 task 08（依存: 07→#5, 03→#4, 06→#8）
- [ ] #10 task 09（依存: 08→#9）
- [ ] #11 task 10（依存: 04→#6）
- [ ] #12 task 11（依存: 09→#10, 10→#11）
- [ ] #20 task 19（依存: 18→#19、決定待ち Q1）
- [ ] #24 task 23（依存: 05→#7）
- [ ] #99 task 99（依存: 03→#4）
MD
  cat >"$issues" <<'JSON'
[
  {"number": 4, "state": "CLOSED", "labels": [{"name": "implementation"}]},
  {"number": 5, "state": "OPEN", "labels": []},
  {"number": 6, "state": "CLOSED", "labels": []},
  {"number": 7, "state": "CLOSED", "labels": []},
  {"number": 8, "state": "CLOSED", "labels": [{"name": "implementation"}]},
  {"number": 9, "state": "OPEN", "labels": []},
  {"number": 10, "state": "OPEN", "labels": []},
  {"number": 11, "state": "OPEN", "labels": [{"name": "implementation"}]},
  {"number": 12, "state": "OPEN", "labels": []},
  {"number": 19, "state": "CLOSED", "labels": []},
  {"number": 20, "state": "OPEN", "labels": []},
  {"number": 24, "state": "OPEN", "labels": []}
]
JSON
}

@test "next-issues without args prints usage and exits 1" {
  run scripts/next-issues.sh
  [ "$status" -eq 1 ]
  [[ "$output" == *"使い方:"* ]]
}

@test "next-issues lists issues whose deps are all checked or closed" {
  run scripts/next-issues.sh "$body" "$issues"
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf '5\n24')" ]
}

@test "next-issues skips an issue waiting on an open unchecked issue" {
  run scripts/next-issues.sh "$body" "$issues"
  [[ "$output" != *"9"* ]]
  [[ "$output" != *"10"* ]]
}

@test "next-issues skips an issue that already has the label" {
  run scripts/next-issues.sh "$body" "$issues"
  [[ "$output" != *"11"* ]]
}

@test "next-issues skips an issue waiting on a decision" {
  run scripts/next-issues.sh "$body" "$issues"
  [[ "$output" != *"20"* ]]
}

@test "next-issues skips an issue missing from the list" {
  run scripts/next-issues.sh "$body" "$issues"
  [[ "$output" != *"99"* ]]
}

@test "next-issues treats a closed issue as done even when unchecked" {
  sed -i.bak 's/"number": 5, "state": "OPEN"/"number": 5, "state": "CLOSED"/' "$issues"
  run scripts/next-issues.sh "$body" "$issues"
  [ "$status" -eq 0 ]
  [ "$output" = "$(printf '9\n24')" ]
}
