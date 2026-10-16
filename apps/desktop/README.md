# @manga/desktop

`apps/web` を Tauri 2 で包んだデスクトップアプリ。仕様は `docs/workstreams/WS-17-desktop-shell.md`。

```sh
pnpm --filter @manga/desktop dev    # apps/web の Vite を起動し、devUrl に繋いだウィンドウを開く
pnpm --filter @manga/desktop build  # apps/web をビルドし、web/dist を frontendDist に同梱する
```

Rust（`mise.toml` の `rust`）と、各 OS の Tauri の前提（macOS は Xcode Command Line Tools）が要る。

- アイコンは `app-icon.svg` から `tauri icon` が `src-tauri/icons/` に作る。`dev` と `build` が毎回作り直すので、コミットしない。
- Rust 側に独自コマンドは無い。ファイルアクセスは `@tauri-apps/plugin-fs` を `apps/web` から直接使う。

## 保存先

`apps/web` は `@manga/storage` の `detectPlatform()` で Tauri の中かを見て、`createStorage('file')` を選ぶ。

- プロジェクトは `$APPDATA/projects/<id>.manga.json`。中身は `parseProject` を通る Project の JSON。
- アセットは `$APPDATA/projects/<id>.manga.assets/` に置き、ref は `file:<id>.manga.assets/<file>`。
- `$APPDATA` は `identifier`（`app.omnistove.manganame`）から決まる。macOS では `~/Library/Application Support/app.omnistove.manganame`。
- `src-tauri/capabilities/default.json` で、plugin-fs の読み書きを `$APPDATA/projects` の中に限る。
