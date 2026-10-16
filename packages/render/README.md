# @manga/render

決定論的レンダラ。同じ `Page` と同じアセットからは同じ PNG が出る。
仕様は `docs/03-data-model.md` の「レンダラ」と `docs/workstreams/WS-02-render.md`。

```sh
pnpm --filter @manga/render test
pnpm --filter @manga/render typecheck
```
