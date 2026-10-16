# 漫画ネーム生成アプリ 設計ドキュメント

作成日: 2026-10-15

原作者がネーム（コマ枠、フキダシ、セリフ、指示メモ）を構造化データとして作り、AI がコマごとの絵を生成し、アプリがコマ枠とフキダシとセリフを合成してネーム画像を出力するアプリの設計書。
出力は漫画家と編集者に渡す。清書や作画機能は持たない。筆圧検知や描画品質は要件外。

## 読む順番

| # | ファイル | 内容 |
|---|---|---|
| 1 | [01-scope.md](01-scope.md) | 何を作り、何を作らないか |
| 2 | [02-architecture.md](02-architecture.md) | 技術スタック、リポジトリ構成、レイヤー構造、生成と合成の流れ |
| 3 | [03-data-model.md](03-data-model.md) | **共有契約。** 全ワークストリームが依存する唯一の前提。先に凍結する |
| 4 | [04-diagnosis-spec.md](04-diagnosis-spec.md) | 視線誘導診断の計算仕様。補助機能 |
| 5 | [05-workstreams.md](05-workstreams.md) | 全 Phase のワークストリーム一覧、依存関係、並列進行ルール |
| 6 | [06-open-questions.md](06-open-questions.md) | 未決事項と決定済み事項 |
| 7 | [07-dependencies.md](07-dependencies.md) | 依存関係図。パッケージ、着手時、統合時、モック供給 |
| 8 | [08-tasks.md](08-tasks.md) | AI エージェントに 1 つずつ渡す単位のタスク一覧。依存、範囲、完了条件、節目。正と着手・完了の状態は [tasks.json](tasks.json) |
| - | [workstreams/](workstreams/) | ワークストリームごとの個別ブリーフ。1 ファイル 1 担当で着手できる |
| - | [fixtures/sample-page-01.json](fixtures/sample-page-01.json) | 6 コマ 1 ページのサンプル。全パッケージの共通入力 |

## 並列進行の前提

- `03-data-model.md` と `04-diagnosis-spec.md` は契約として凍結する。変更は PR で提案し、全ワークストリームに通知する。
- 各ワークストリームは `docs/workstreams/WS-*.md` だけ読めば着手できるように書いてある。
- 他ワークストリームの成果物は待たない。契約に沿ったモックまたはフィクスチャで代替する。
- 統合は Phase 末にまとめて行う。統合手順は `05-workstreams.md` に書いてある。
