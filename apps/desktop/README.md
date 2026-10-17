# @manga/desktop

`apps/web` を Tauri 2 で包んだデスクトップアプリ。

Rust（`mise.toml` の `rust`）と、各 OS の Tauri の前提（macOS は Xcode Command Line Tools）が要る。

```sh
pnpm --filter @manga/desktop dev
pnpm --filter @manga/desktop build
```

## リリース

`apps/desktop/package.json` と `src-tauri/tauri.conf.json` の version を揃えてから、同じ version の `v*` タグを push する。`.github/workflows/desktop-release.yml` が両 OS のインストーラを署名して GitHub Releases に上げる。要る secrets はそのワークフローの冒頭に書いてある。

```sh
pnpm --filter @manga/desktop version:set 1.2.3
pnpm --filter @manga/desktop version:check
git tag v1.2.3 && git push origin v1.2.3
```
