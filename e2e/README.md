# @manga/e2e

apps/web と apps/desktop の主要フローを Playwright で通す e2e。

初回は Chromium を入れる。

```sh
pnpm --filter @manga/e2e exec playwright install chromium
```

`e2e:desktop` は tauri-driver が動く Linux だけで通る。要るパッケージと先に済ませるビルドは `.github/workflows/e2e.yml` の `desktop` ジョブ。
