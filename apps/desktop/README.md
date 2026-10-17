# @manga/desktop

`apps/web` を Tauri 2 で包んだデスクトップアプリ。

Rust（`mise.toml` の `rust`）と、各 OS の Tauri の前提（macOS は Xcode Command Line Tools）が要る。

## リリース

version を揃えて同じ version の `v*` タグを push する。要る secrets は `.github/workflows/desktop-release.yml` の冒頭。

```sh
pnpm --filter @manga/desktop version:set 1.2.3
git tag v1.2.3 && git push origin v1.2.3
```
