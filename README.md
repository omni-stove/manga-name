# manga

漫画ネーム生成アプリ。原作者が切ったネーム（コマ枠、フキダシ、セリフ、指示メモ）から AI がコマの絵を生成し、漫画家と編集者に渡すネーム画像を出力する。設計書は [docs/](docs/README.md)。

```sh
make setup
make dev     # workers/api (:8787) と apps/web (:5173) をまとめて起動。ローカル D1 のマイグレーションも当てる
pnpm check
```

API は `ENVIRONMENT=development` で立つので、ログインせずに `X-Debug-User: you@example.com` ヘッダで叩ける。AI 生成を試すときは `workers/api/.env` に `GEMINI_API_KEY` などを書く。片方だけ起動するなら `make dev-web` / `make dev-api`。デスクトップアプリは `make dev-desktop`（API と Tauri を起動し、Tauri が apps/web を立てる。`make dev` とはポートがぶつかるので同時には動かさない）。

開発の進め方とパッケージの追加手順は [CONTRIBUTING.md](CONTRIBUTING.md)。
