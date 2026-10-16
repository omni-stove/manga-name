# @manga/render

決定論的レンダラと PDF 書き出し。同じ `Page` と同じアセットからは同じ PNG が出る。`exportPdf` はエピソードのページを PDF に束ねる。
仕様は `docs/03-data-model.md` の「レンダラ」、`docs/workstreams/WS-02-render.md`、PDF 書き出しは `docs/workstreams/WS-08-export.md`。

```sh
pnpm --filter @manga/render test
pnpm --filter @manga/render typecheck
```
