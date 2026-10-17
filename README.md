# manga

漫画ネーム生成アプリ。原作者が切ったネーム（コマ枠、フキダシ、セリフ、指示メモ）から AI がコマの絵を生成し、漫画家と編集者に渡すネーム画像を出力する。設計書は [docs/](docs/README.md)。

```sh
make setup
make dev
```

ほかのコマンドは `mise tasks`。AI 生成を試すときは `workers/api/.env` に API キーを書く（名前は `workers/api/src/env.ts`）。

開発の進め方とパッケージの追加手順は [CONTRIBUTING.md](CONTRIBUTING.md)。
