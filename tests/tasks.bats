#!/usr/bin/env bats
# scripts/tasks.mjs の CLI を、docs/tasks.json を書き換えない範囲で確認する。
# テスト名は ASCII にする。bats は非 UTF-8 ロケールで実行されると日本語名を解決できない。

setup() {
  cd "$BATS_TEST_DIRNAME/.."
}

@test "tasks without args prints usage and exits 1" {
  run node scripts/tasks.mjs
  [ "$status" -eq 1 ]
  [[ "$output" == *"使い方:"* ]]
}

@test "tasks show prints an existing task" {
  run node scripts/tasks.mjs show 01
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == 01\ * ]]
  [[ "$output" == *"状態:"* ]]
}

@test "tasks show exits 1 for an unknown id" {
  run node scripts/tasks.mjs show 999
  [ "$status" -eq 1 ]
  [[ "$output" == *"999"* ]]
}

@test "make forwards a task and its args to mise run" {
  command -v mise >/dev/null || skip "mise is not installed"
  run make tasks show 01
  [ "$status" -eq 0 ]
  # mise はコマンドの echo 行を先に出すので、先頭行ではなく行単位で探す
  echo "$output" | grep -q '^01 '
  [[ "$output" == *"状態:"* ]]
}
