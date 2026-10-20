# @manga/desktop

`apps/web` を Tauri 2 で包んだデスクトップアプリ。

Rust（`mise.toml` の `rust`）と、各 OS の Tauri の前提（macOS は Xcode Command Line Tools）が要る。

ログインは OS のブラウザから `manganame://` の deep link で戻る。macOS は `tauri dev` ではこの scheme を受けられないので、ログインはビルドした `.app` を `/Applications` に置いて確かめる。

## リリース

version を揃えて同じ version の `v*` タグを push する。要る secrets は `.github/workflows/desktop-release.yml` の冒頭。

```sh
pnpm --filter @manga/desktop version:set 1.2.3
git tag v1.2.3 && git push origin v1.2.3
```
