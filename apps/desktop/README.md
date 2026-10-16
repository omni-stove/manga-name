# @manga/desktop

`apps/web` を Tauri 2 で包んだデスクトップアプリ。仕様は `docs/workstreams/WS-17-desktop-shell.md`。

Rust（`mise.toml` の `rust`）と、各 OS の Tauri の前提（macOS は Xcode Command Line Tools）が要る。

```sh
pnpm --filter @manga/desktop dev
pnpm --filter @manga/desktop build
```
