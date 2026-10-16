# @manga/e2e

apps/web の主要フローを Playwright で通す e2e。仕様は `docs/workstreams/WS-21-e2e-hardening.md`。生成は Fake プロバイダ（AI プロキシ未設定の既定）で行う。

```sh
pnpm --filter @manga/e2e exec playwright install chromium  # 初回だけ
pnpm --filter @manga/e2e e2e
```

webServer が apps/web をビルドして `vite preview`（4173 番）で配る。CI（`.github/workflows/e2e.yml`）は毎晩 03:00 JST に main で走り、Actions の画面から手動でも起動できる。失敗したテストのスクリーンショットとトレースが artifact `e2e-report` に残り、`pnpm --filter @manga/e2e exec playwright show-trace <trace.zip>` で開ける。
