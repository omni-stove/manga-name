# @manga/e2e

apps/web の主要フローを Playwright で通す e2e。仕様は `docs/workstreams/WS-21-e2e-hardening.md`。生成は Fake プロバイダ（AI プロキシ未設定の既定）で行う。

```sh
pnpm --filter @manga/e2e exec playwright install chromium  # 初回だけ
pnpm --filter @manga/e2e e2e
```

webServer が apps/web をビルドして `vite preview`（4173 番）で配る。プロジェクト `collab` は `VITE_COLLAB_TABS=1` で別にビルドした apps/web（4174 番）に対して、シナリオ 1, 2, 3 と `collab-*.e2e.ts` を共同編集モードで流す。このビルドは同じブラウザのタブ同士を SharedWorker の同期サーバでつなぐので、workers/api もログインも要らない（仕様は `docs/workstreams/WS-19-collaboration.md`）。プロジェクト `cloud` は workers/api を `wrangler dev`（8789 番、`e2e/.wrangler` に D1 と R2 を置く）で立て、`VITE_API_BASE_URL` でそこにつなぐ apps/web（4175 番）で `cloud-*.e2e.ts`（シナリオ 7）を流す。Google のログインは通せないので、テストが `/v1/auth/*` の往復だけを答え、API には development の `X-Debug-User` でユーザーを名乗る（仕様は `docs/workstreams/WS-15-cloud-storage.md`）。CI（`.github/workflows/e2e.yml`）は毎晩 03:00 JST に main で走り、Actions の画面から手動でも起動できる。失敗したテストのスクリーンショットとトレースが artifact `e2e-report` に残り、`pnpm --filter @manga/e2e exec playwright show-trace <trace.zip>` で開ける。
