# @manga/diagnosis

`docs/04-diagnosis-spec.md` を実装する純粋関数。UI も I/O も持たない。
ランタイム依存は `@manga/schema` のみ。

```sh
pnpm --filter @manga/diagnosis test
pnpm --filter @manga/diagnosis typecheck
```

## 公開 API

| export | 内容 |
|---|---|
| `sweepPath(panel, direction)` | コマの視線経路。ページ座標の点列 |
| `projectOntoSweep(panel, pos, direction)` | コマ内座標の点を経路に射影した `{ t, distance }` |
| `inferReadingOrder(panels, direction)` | 配置から推定した Panel id の読み順 |
