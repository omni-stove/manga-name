# @manga/web

Vite + React 19 + TanStack Router（file-based）の Web アプリ。仕様は `docs/workstreams/WS-06-app-shell.md`。

```sh
pnpm --filter @manga/web dev
pnpm --filter @manga/web typecheck
pnpm --filter @manga/web test
pnpm --filter @manga/web size        # 初期ロード 500KB gzip 以内か（PR の CI）
pnpm --filter @manga/web lighthouse  # エディタ画面の TTI 3 秒以内か（毎晩の Perf）
```

`lighthouse` はインストール済みの Chrome を使う。
